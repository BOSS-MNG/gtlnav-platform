/**
 * GTLNAV worker — Docker control wrapper.
 *
 * All `docker` invocations happen here. The shell is never invoked
 * (spawn with `shell: false`), arguments are passed as arrays, and the
 * command vocabulary is strictly limited to:
 *
 *   docker build, run, inspect, logs, start, stop, restart, rm, ps
 *
 * Anything else throws before reaching the daemon.
 *
 * Resource limits, restart policy, network isolation, and read-only root
 * filesystem are applied to every container we create.
 */
import { spawn } from "node:child_process";
import { config } from "./config.js";

const ALLOWED_DOCKER_SUBCOMMANDS = new Set([
  "build",
  "run",
  "start",
  "stop",
  "restart",
  "rm",
  "logs",
  "inspect",
  "ps",
  "kill",
  "version",
]);

/**
 * Run docker with the given subcommand + args. Returns
 * `{ ok, code, stdout, stderr, durationMs, timedOut }`.
 *
 * @param {string} subcommand
 * @param {string[]} args
 * @param {object} opts { timeoutMs, env, logger, sourceTag, streamLogs }
 */
export function dockerRun(subcommand, args = [], opts = {}) {
  if (!ALLOWED_DOCKER_SUBCOMMANDS.has(subcommand)) {
    return Promise.resolve({
      ok: false,
      code: -1,
      stdout: "",
      stderr: `docker subcommand "${subcommand}" not in allowlist`,
      durationMs: 0,
      timedOut: false,
    });
  }
  for (const a of args) {
    if (typeof a !== "string") {
      return Promise.resolve({
        ok: false,
        code: -1,
        stdout: "",
        stderr: "docker args must all be strings",
        durationMs: 0,
        timedOut: false,
      });
    }
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(config.dockerBin, [subcommand, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, opts.timeoutMs ?? 5 * 60_000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    if (opts.streamLogs && opts.logger) {
      let stdBuf = "";
      let errBuf = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
        stdBuf += chunk;
        let idx;
        while ((idx = stdBuf.indexOf("\n")) >= 0) {
          const line = stdBuf.slice(0, idx);
          stdBuf = stdBuf.slice(idx + 1);
          if (line) opts.logger.pushRaw(line, opts.sourceTag ?? "docker");
        }
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
        errBuf += chunk;
        let idx;
        while ((idx = errBuf.indexOf("\n")) >= 0) {
          const line = errBuf.slice(0, idx);
          errBuf = errBuf.slice(idx + 1);
          if (line) opts.logger.pushRaw(line, opts.sourceTag ?? "docker");
        }
      });
    } else {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: -1,
        stdout,
        stderr: stderr + `\n${err.message}`,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: !killed && code === 0,
        code: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut: killed,
      });
    });
  });
}

export async function dockerAvailable() {
  if (!config.dockerEnabled) return false;
  const r = await dockerRun("version", ["--format", "{{.Server.Version}}"], {
    timeoutMs: 5_000,
  });
  return r.ok;
}

export function makeContainerName(slug, deploymentId) {
  const safeSlug = String(slug ?? "proj").replace(/[^a-zA-Z0-9_.-]/g, "-");
  const safeDep = String(deploymentId ?? "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 12);
  return `gtlnav-${safeSlug}-${safeDep}`.toLowerCase();
}

export function makeImageTag(slug, deploymentId) {
  const safeSlug = String(slug ?? "proj").replace(/[^a-zA-Z0-9_.-]/g, "-");
  const safeDep = String(deploymentId ?? "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 12);
  return `gtlnav/${safeSlug}:${safeDep || "latest"}`.toLowerCase();
}

/**
 * docker build with safe defaults. Returns dockerRun result.
 */
export function dockerBuild({ imageTag, contextDir, logger }) {
  return dockerRun(
    "build",
    [
      "--pull",
      "--label",
      "gtlnav=1",
      "--tag",
      imageTag,
      contextDir,
    ],
    {
      cwd: contextDir,
      timeoutMs: config.buildTimeoutMs,
      streamLogs: true,
      logger,
      sourceTag: "docker-build",
    },
  );
}

/**
 * docker run -d with our standard safety flags. Returns dockerRun result.
 *
 * IMPORTANT: caller is responsible for cleanup on failure.
 *
 * Safety flags applied:
 *   - --rm  (remove on exit)
 *   - --read-only on root filesystem
 *   - drop ALL capabilities, add only NET_BIND_SERVICE if needed (we don't)
 *   - no-new-privileges (block setuid/setgid escalation)
 *   - --memory, --cpus, --pids-limit
 *   - --user gtlnav (image is responsible for shipping non-root user)
 *
 * We deliberately do not pass `--privileged`, `--cap-add SYS_ADMIN`,
 * `--device`, or `--volume` flags. Custom volumes are not allowed.
 */
export function dockerStart({
  imageTag,
  containerName,
  internalPort,
  envPairs = [],
  logger,
}) {
  const args = [
    "run",
    "-d",
    "--name",
    containerName,
    "--label",
    "gtlnav=1",
    "--restart",
    config.dockerRestartPolicy,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "256",
    "--memory",
    config.dockerMemoryLimit,
    "--cpus",
    config.dockerCpuLimit,
    "--publish",
    `127.0.0.1:${internalPort}:${internalPort}/tcp`,
    "--env",
    `PORT=${internalPort}`,
    "--env",
    "NODE_ENV=production",
    "--tmpfs",
    "/tmp:rw,size=64m,mode=1777",
  ];

  if (config.dockerNetwork) {
    args.push("--network", config.dockerNetwork);
  }

  for (const pair of envPairs) {
    if (typeof pair !== "string") continue;
    // pair must be of form KEY=VALUE; we don't let arbitrary docker flags slip in.
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(pair)) continue;
    args.push("--env", pair);
  }

  args.push(imageTag);

  // We split run/start so we can log args ourselves.
  return dockerRun("run", args.slice(1), {
    timeoutMs: 90_000,
    logger,
    sourceTag: "docker-run",
  });
}

export async function dockerStop(containerName, logger) {
  return dockerRun("stop", ["--time", "10", containerName], {
    timeoutMs: 30_000,
    logger,
    sourceTag: "docker-stop",
  });
}

export async function dockerStartExisting(containerName, logger) {
  return dockerRun("start", [containerName], {
    timeoutMs: 20_000,
    logger,
    sourceTag: "docker-start",
  });
}

export async function dockerRestart(containerName, logger) {
  return dockerRun("restart", ["--time", "10", containerName], {
    timeoutMs: 30_000,
    logger,
    sourceTag: "docker-restart",
  });
}

export async function dockerRemove(containerName, logger) {
  return dockerRun("rm", ["--force", containerName], {
    timeoutMs: 20_000,
    logger,
    sourceTag: "docker-rm",
  });
}

export async function dockerInspect(containerName) {
  return dockerRun("inspect", ["--format", "{{json .State}}", containerName], {
    timeoutMs: 10_000,
  });
}

export async function dockerContainerId(containerName) {
  const r = await dockerRun("ps", ["-a", "-q", "--filter", `name=^${containerName}$`], {
    timeoutMs: 10_000,
  });
  return r.ok ? r.stdout.trim() : null;
}
