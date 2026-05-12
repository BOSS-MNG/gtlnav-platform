/**
 * GTLNAV deployment-worker — build pipeline.
 *
 * Given a claimed job, this module:
 *   1. clones the repo into a unique working directory
 *   2. checks out the requested branch (or commit, if pinned)
 *   3. detects framework / package manager
 *   4. runs install + build with logs streamed back to the control plane
 *   5. copies the static output into $DEPLOYMENTS_ROOT/<slug>/<deployment_id>
 *   6. atomically flips $DEPLOYMENTS_ROOT/<slug>/current → that folder
 *
 * Errors at any step are returned (not thrown) so the caller can call
 * /api/worker/fail with a clean message.
 */
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import { config } from "./config.js";
import { detectFramework, resolveStaticPublishDir } from "./framework.js";
import { runDockerBuild } from "./docker-build.js";
import { registerProxyRoute, upsertRuntimeInstance } from "./api.js";

const ALLOWED_BUILD_BIN = new Set(["npm", "pnpm", "yarn", "node"]);

/** Spawn a command. Streams stdout/stderr to logger.pushRaw. */
function runCommand(command, args, opts, logger, sourceTag = "build") {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
    });

    const startedAt = Date.now();
    let killed = false;
    const timeout = setTimeout(() => {
      killed = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, opts.timeoutMs ?? config.buildTimeoutMs);

    function streamLines(stream) {
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line) logger.pushRaw(line, sourceTag);
        }
      });
      stream.on("end", () => {
        if (buf) logger.pushRaw(buf, sourceTag);
      });
    }

    streamLines(child.stdout);
    streamLines(child.stderr);

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: -1,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        ok: code === 0 && !killed,
        code: code ?? -1,
        signal: signal ?? null,
        timedOut: killed,
        durationMs: Date.now() - startedAt,
        error: null,
      });
    });
  });
}

function parseCommand(line) {
  if (!line || typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Reject any obviously dangerous chaining; we do NOT spawn through a shell.
  if (/[&;|`$<>]/.test(trimmed)) {
    return { _error: "Build command contains disallowed shell characters." };
  }
  const tokens = trimmed.split(/\s+/);
  const bin = tokens.shift();
  if (!bin || !ALLOWED_BUILD_BIN.has(bin)) {
    return {
      _error: `Build command must start with one of: ${[...ALLOWED_BUILD_BIN].join(", ")}.`,
    };
  }
  return { bin, args: tokens };
}

/** Resolve the GitHub clone URL with optional bearer-style token injection. */
function withCloneAuth(repoUrl, token) {
  if (!token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    if (u.hostname !== "github.com") return repoUrl; // Only inject for GH.
    u.username = "x-access-token";
    u.password = token;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

/**
 * Atomically replace `<root>/<slug>/current` with `<root>/<slug>/<deploymentId>`.
 * Uses rename + cleanup so Caddy serves a consistent tree under file_server.
 */
async function publishStatic(repoRoot, sourceDir, slug, deploymentId, logger) {
  const projectRoot = path.join(config.deploymentsRoot, slug);
  const targetDir = path.join(projectRoot, deploymentId);
  const currentLink = path.join(projectRoot, "current");

  await fs.mkdir(projectRoot, { recursive: true });

  // 1. Copy build output to the deployment-id-keyed folder.
  const absoluteSource = path.resolve(repoRoot, sourceDir);
  await fs.cp(absoluteSource, targetDir, {
    recursive: true,
    errorOnExist: false,
    force: true,
  });
  logger.info(
    `Copied ${absoluteSource} → ${targetDir}`,
    "publish",
  );

  // 2. Replace "current" pointer. On posix we try a symlink first;
  //    on Windows (or if symlink fails), fall back to a rename of a
  //    staging folder so the served tree is always complete.
  const tmpDir = `${currentLink}.swap-${Date.now()}`;
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.symlink(targetDir, tmpDir, "dir");
    await fs.rename(tmpDir, currentLink);
    logger.info(`Pointer current → ${deploymentId} updated (symlink).`, "publish");
  } catch (symErr) {
    // Symlink not permitted (Windows w/out admin, certain mount points). Use
    // a renamed sibling folder instead.
    logger.warn(
      `Symlink not available (${symErr.message}). Using rename pointer.`,
      "publish",
    );
    const oldCurrent = `${currentLink}.old-${Date.now()}`;
    try {
      await fs.rename(currentLink, oldCurrent);
    } catch {
      /* current may not exist yet */
    }
    try {
      await fs.cp(targetDir, currentLink, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    } finally {
      await fs.rm(oldCurrent, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { projectRoot, targetDir, currentLink };
}

/**
 * Main entry point. Returns:
 *   { ok: true,  deploymentUrl, artifactPath, durationMs, framework }
 *   { ok: false, errorMessage, stage }
 */
export async function runBuild({ job, logger }) {
  const startedAt = Date.now();
  const payload = job.payload ?? {};

  // Phase 6B payload shape (preferred):
  //   payload.{repo_url, branch, commit_sha, project_slug, install_command,
  //            build_command, build_output_dir, runtime_kind, hosting_kind, ...}
  // Phase 6A back-compat:
  //   payload.project.{repo_url, slug, default_branch}
  const legacyProject = payload.project ?? {};
  const repoUrl =
    payload.repo_url ?? legacyProject.repo_url ?? null;
  const branch =
    payload.branch ??
    payload.default_branch ??
    legacyProject.default_branch ??
    "main";
  const commitSha = payload.commit_sha ?? null;
  const slug =
    payload.project_slug ??
    legacyProject.slug ??
    `proj-${job.project_id?.slice?.(0, 8) ?? "x"}`;

  if (!repoUrl) {
    return {
      ok: false,
      stage: "preflight",
      errorMessage:
        "Project has no repo_url. Connect a GitHub repo before deploying.",
    };
  }

  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gtlnav-build-"));
  logger.info(`Workspace: ${workRoot}`, "runner");

  try {
    // ---------------------------- clone ------------------------------------
    logger.info(`Cloning ${repoUrl} @ ${branch}…`, "git");
    const cloneUrl = withCloneAuth(repoUrl, config.githubToken);
    const clone = await runCommand(
      "git",
      ["clone", "--depth", "1", "--branch", branch, cloneUrl, "repo"],
      { cwd: workRoot, env: process.env },
      logger,
      "git",
    );
    if (!clone.ok) {
      return {
        ok: false,
        stage: "clone",
        errorMessage: clone.timedOut
          ? "git clone timed out"
          : `git clone failed (exit ${clone.code})`,
      };
    }

    const repoRoot = path.join(workRoot, "repo");
    if (commitSha) {
      logger.info(`Checking out commit ${commitSha}`, "git");
      const fetchOne = await runCommand(
        "git",
        ["fetch", "--depth", "1", "origin", commitSha],
        { cwd: repoRoot, env: process.env },
        logger,
        "git",
      );
      if (fetchOne.ok) {
        await runCommand(
          "git",
          ["checkout", "--detach", commitSha],
          { cwd: repoRoot, env: process.env },
          logger,
          "git",
        );
      } else {
        logger.warn(
          `Could not fetch ${commitSha}; staying on branch head.`,
          "git",
        );
      }
    }

    // -------------------------- detect framework --------------------------
    const detection = await detectFramework(repoRoot, {
      installCommand: payload.install_command ?? legacyProject.install_command ?? null,
      buildCommand: payload.build_command ?? legacyProject.build_command ?? null,
      buildOutputDir:
        payload.build_output_dir ?? legacyProject.build_output_dir ?? null,
      runtimeKindHint: payload.runtime_kind ?? null,
      hostingKindHint: payload.hosting_kind ?? null,
    });
    for (const note of detection.notes) logger.info(note, "detect");
    if (detection.framework === "unsupported") {
      return {
        ok: false,
        stage: "detect",
        errorMessage:
          "Unsupported project shape. Supported: static (Next export, Vite, CRA, Astro, Nuxt-generate, plain HTML) and docker (Dockerfile, Next SSR, Express, Koa, Fastify, Hapi, Nest, npm start).",
      };
    }
    logger.info(
      `Hosting kind resolved: ${detection.hostingKind} (${detection.framework}).`,
      "detect",
    );

    // ---------------------- branch: docker runtime ------------------------
    // The Docker path skips the static publish step entirely. Install + build
    // happen INSIDE the Docker image so the worker host stays clean.
    if (detection.hostingKind === "docker") {
      const deploymentId = job.deployment_id ?? crypto.randomUUID();
      const dockerResult = await runDockerBuild({
        repoRoot,
        detection,
        slug,
        deploymentId,
        // Phase 6B does not forward project_envs to the container; that ships
        // in a later phase when secrets are encrypted server-side.
        envPairs: [],
        logger,
      });
      if (!dockerResult.ok) {
        return {
          ok: false,
          stage: dockerResult.stage,
          errorMessage: dockerResult.errorMessage,
        };
      }
      const deploymentUrl = `https://${slug}.${config.deployBaseDomain}`;

      // Register runtime_instances row + proxy route. Control plane handles
      // upsert semantics, demotion of previously-active rows, and retries
      // are safe. Phase 6C: field is `runtime_kind` (matches the schema in
      // migration 0006); the legacy `hosting_kind` name is no longer sent.
      const runtimeUpsert = await upsertRuntimeInstance({
        worker_id: config.workerLabel,
        deployment_id: deploymentId,
        project_id: job.project_id ?? null,
        user_id: job.user_id ?? null,
        runtime_kind: "docker",
        target_state: "running",
        // `status` mirrors target_state so the partial unique index
        // `runtime_instances_project_active` (where status in ('running',
        // 'starting')) is enforced for redeploys.
        status: "running",
        internal_port: dockerResult.internalPort,
        container_id: dockerResult.containerId,
        container_name: dockerResult.containerName,
        image_tag: dockerResult.imageTag,
        dockerfile_source: dockerResult.dockerfileSource,
        last_health_status: dockerResult.healthStatus,
        framework: detection.framework,
      });
      if (!runtimeUpsert.ok) {
        logger.warn(
          `runtime_instances upsert failed (${runtimeUpsert.status}); container is up but won't be tracked.`,
          "runtime",
        );
      }
      const routeReg = await registerProxyRoute({
        worker_id: config.workerLabel,
        hostname: `${slug}.${config.deployBaseDomain}`,
        upstream_kind: "docker",
        upstream_target: `127.0.0.1:${dockerResult.internalPort}`,
        project_id: job.project_id ?? null,
        user_id: job.user_id ?? null,
        deployment_id: deploymentId,
      });
      if (!routeReg.ok) {
        logger.warn(
          `proxy_routes register failed (${routeReg.status}); add the route manually.`,
          "proxy",
        );
      }
      logger.success(`Docker deployment live at ${deploymentUrl}`, "publish");
      return {
        ok: true,
        deploymentUrl,
        artifactPath: dockerResult.imageTag,
        durationMs: Date.now() - startedAt,
        framework: detection.framework,
        hostingKind: "docker",
        internalPort: dockerResult.internalPort,
        containerName: dockerResult.containerName,
        imageTag: dockerResult.imageTag,
      };
    }

    // -------------------------- install -----------------------------------
    if (detection.installCommand && !config.dryRun) {
      const parsed = parseCommand(detection.installCommand);
      if (!parsed || parsed._error) {
        return {
          ok: false,
          stage: "install",
          errorMessage: parsed?._error ?? "Invalid install command.",
        };
      }
      logger.info(`Installing dependencies (${detection.installCommand})…`, "install");
      const installRes = await runCommand(
        parsed.bin,
        parsed.args,
        { cwd: repoRoot, env: process.env },
        logger,
        "install",
      );
      if (!installRes.ok) {
        return {
          ok: false,
          stage: "install",
          errorMessage: installRes.timedOut
            ? "Install step timed out."
            : `Install failed (exit ${installRes.code}).`,
        };
      }
    }

    // ---------------------------- build -----------------------------------
    if (detection.buildCommand && !config.dryRun) {
      const parsed = parseCommand(detection.buildCommand);
      if (!parsed || parsed._error) {
        return {
          ok: false,
          stage: "build",
          errorMessage: parsed?._error ?? "Invalid build command.",
        };
      }
      logger.info(`Running build (${detection.buildCommand})…`, "build");
      const buildRes = await runCommand(
        parsed.bin,
        parsed.args,
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            NODE_ENV: "production",
            CI: "1",
          },
        },
        logger,
        "build",
      );
      if (!buildRes.ok) {
        return {
          ok: false,
          stage: "build",
          errorMessage: buildRes.timedOut
            ? "Build step timed out."
            : `Build failed (exit ${buildRes.code}).`,
        };
      }
      logger.success(`Build completed in ${buildRes.durationMs}ms.`, "build");
    }

    // ----------------------- locate publish dir ---------------------------
    const publishDir = await resolveStaticPublishDir(
      repoRoot,
      detection.publishDir,
    );
    if (!publishDir) {
      return {
        ok: false,
        stage: "publish",
        errorMessage:
          "Could not locate static output directory. Set build_output_dir on the project (e.g. 'out', 'dist', 'build').",
      };
    }
    const absolutePublish = path.join(repoRoot, publishDir);
    let stat;
    try {
      stat = await fs.stat(absolutePublish);
    } catch {
      return {
        ok: false,
        stage: "publish",
        errorMessage: `Expected static output at ${publishDir}, but the directory does not exist.`,
      };
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        stage: "publish",
        errorMessage: `Expected ${publishDir} to be a directory; got a file.`,
      };
    }

    // -------------------------- publish -----------------------------------
    logger.info("Publishing static bundle…", "publish");
    const deploymentId = job.deployment_id ?? crypto.randomUUID();
    const { targetDir } = await publishStatic(
      repoRoot,
      publishDir,
      slug,
      deploymentId,
      logger,
    );

    const deploymentUrl = `https://${slug}.${config.deployBaseDomain}`;

    // Register runtime instance (static) + proxy route so the proxy can
    // serve it. Phase 6C: field is `runtime_kind` (existing column on
    // runtime_instances). We also send `status: 'running'` so the partial
    // unique index `runtime_instances_project_active` actually enforces
    // single-active-per-project — the control plane endpoint demotes any
    // prior active rows before inserting.
    const runtimeUpsert = await upsertRuntimeInstance({
      worker_id: config.workerLabel,
      deployment_id: deploymentId,
      project_id: job.project_id ?? null,
      user_id: job.user_id ?? null,
      runtime_kind: "static",
      target_state: "running",
      status: "running",
      serve_path: targetDir,
      framework: detection.framework,
      last_health_status: "healthy",
    });
    if (!runtimeUpsert.ok) {
      logger.warn(
        `runtime_instances upsert failed (${runtimeUpsert.status}); static folder is published but won't be tracked.`,
        "runtime",
      );
    }
    const routeReg = await registerProxyRoute({
      worker_id: config.workerLabel,
      hostname: `${slug}.${config.deployBaseDomain}`,
      upstream_kind: "static",
      serve_path: targetDir,
      project_id: job.project_id ?? null,
      user_id: job.user_id ?? null,
      deployment_id: deploymentId,
    });
    if (!routeReg.ok) {
      logger.warn(
        `proxy_routes register failed (${routeReg.status}); add the route manually.`,
        "proxy",
      );
    }

    logger.success(`Deployment live at ${deploymentUrl}`, "publish");

    return {
      ok: true,
      deploymentUrl,
      artifactPath: targetDir,
      durationMs: Date.now() - startedAt,
      framework: detection.framework,
      hostingKind: "static",
    };
  } finally {
    // Always clean the temp clone — never leave repo contents on disk.
    await fs.rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
