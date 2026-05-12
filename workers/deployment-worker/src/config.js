/**
 * GTLNAV deployment-worker — configuration loader.
 *
 * All settings come from environment variables so the worker can be run
 * locally, in CI, or under a process manager (systemd, pm2) without code
 * changes. `dotenv` is loaded once at startup if a .env file is present.
 */
import path from "node:path";
import url from "node:url";
import { config as loadDotenv } from "dotenv";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotenv({ path: path.resolve(__dirname, "..", ".env"), override: false });

function readString(name, { required = false, fallback = null } = {}) {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    if (required) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return fallback;
  }
  return value;
}

function readInt(name, { fallback }) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function readBool(name, { fallback }) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const v = String(raw).toLowerCase().trim();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

export const config = Object.freeze({
  /** Public base URL of the GTLNAV control plane (e.g. https://gtlnav.app). */
  appUrl: readString("GTLNAV_APP_URL", { required: true }),
  /** Shared secret used for x-gtlnav-worker-secret. */
  workerSecret: readString("GTLNAV_WORKER_SECRET", { required: true }),
  /** Human-friendly worker label captured in audit logs. */
  workerLabel: readString("GTLNAV_WORKER_LABEL", { fallback: "static-worker-1" }),
  /** Apex domain that preview / project subdomains live under. */
  deployBaseDomain: readString("GTLNAV_DEPLOY_BASE_DOMAIN", {
    fallback: "gtlnav.app",
  }),
  /** Filesystem root where build outputs are published. */
  deploymentsRoot: path.resolve(
    readString("DEPLOYMENTS_ROOT", { fallback: "./deployments" }),
  ),
  /** Optional GitHub token for cloning private repos. */
  githubToken: readString("GITHUB_TOKEN", { fallback: null }),
  /** How often (ms) the worker re-asks for work when the queue is empty. */
  pollIntervalMs: readInt("GTLNAV_WORKER_POLL_INTERVAL_MS", { fallback: 4000 }),
  /** Cap on a single build's wall-clock time. */
  buildTimeoutMs: readInt("GTLNAV_WORKER_BUILD_TIMEOUT_MS", {
    fallback: 15 * 60 * 1000,
  }),
  /** Run a single claim attempt then exit (useful for cron / CI / debug). */
  runOnce: readBool("GTLNAV_WORKER_RUN_ONCE", { fallback: false }),
  /** When true, never run install/build — useful for proxy / smoke tests. */
  dryRun: readBool("GTLNAV_WORKER_DRY_RUN", { fallback: false }),
  /** Caps the log buffer per build so we don't OOM on chatty toolchains. */
  maxLogBytes: readInt("GTLNAV_WORKER_MAX_LOG_BYTES", {
    fallback: 4 * 1024 * 1024,
  }),
  // -------------------------------------------------------------------------
  // Phase 6B — Docker / runtime settings.
  // -------------------------------------------------------------------------
  /** Enable the Docker code path. When false the worker stays static-only. */
  dockerEnabled: readBool("GTLNAV_WORKER_DOCKER_ENABLED", { fallback: true }),
  /** docker CLI binary; defaults to the system PATH lookup of "docker". */
  dockerBin: readString("GTLNAV_WORKER_DOCKER_BIN", { fallback: "docker" }),
  /** Optional bridge network so containers share a subnet without --network host. */
  dockerNetwork: readString("GTLNAV_WORKER_DOCKER_NETWORK", { fallback: null }),
  /** Memory limit applied to every container (Docker --memory flag). */
  dockerMemoryLimit: readString("GTLNAV_WORKER_DOCKER_MEMORY", {
    fallback: "512m",
  }),
  /** CPU limit (Docker --cpus flag). */
  dockerCpuLimit: readString("GTLNAV_WORKER_DOCKER_CPUS", { fallback: "0.5" }),
  /** docker restart policy. "no" leaves restarts to GTLNAV; "on-failure:3" is also reasonable. */
  dockerRestartPolicy: readString("GTLNAV_WORKER_DOCKER_RESTART", {
    fallback: "no",
  }),
  /** Port-allocator window. The worker assigns 127.0.0.1:<port> per container. */
  runtimePortMin: readInt("GTLNAV_RUNTIME_PORT_MIN", { fallback: 34000 }),
  runtimePortMax: readInt("GTLNAV_RUNTIME_PORT_MAX", { fallback: 34999 }),
  /** HTTP health-check budget — total wait + per-attempt timeout. */
  healthTimeoutMs: readInt("GTLNAV_WORKER_HEALTH_TIMEOUT_MS", {
    fallback: 60_000,
  }),
  healthAttemptIntervalMs: readInt(
    "GTLNAV_WORKER_HEALTH_INTERVAL_MS",
    { fallback: 1500 },
  ),
});

export const ENDPOINTS = Object.freeze({
  claim: `${config.appUrl}/api/worker/claim-job`,
  status: `${config.appUrl}/api/worker/status`,
  logs: `${config.appUrl}/api/worker/logs`,
  complete: `${config.appUrl}/api/worker/complete`,
  fail: `${config.appUrl}/api/worker/fail`,
  routeRegister: `${config.appUrl}/api/worker/route-register`,
  runtimeUpsert: `${config.appUrl}/api/worker/runtime-instance`,
});
