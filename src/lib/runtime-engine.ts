/**
 * GTLNAV Real Deployment Engine — lifecycle foundation (in-process).
 *
 * Drives queued → preparing → … → active with concurrency, cancellation,
 * retries, rollback simulation, build-cache and artifact logs.
 *
 * Provider hooks (Coolify, Dokploy, Docker, Hetzner VPS) are represented
 * only as metadata/log lines — no outbound API calls.
 */

import {
  assignWorker,
  busyWorkerCount,
  cloneWorkerFleet,
  pickWorkerForJob,
  releaseWorker,
  type DeploymentWorker,
} from "@/src/lib/deployment-workers";

export const RUNTIME_DEPLOYMENT_STATUSES = [
  "queued",
  "preparing",
  "cloning",
  "installing",
  "building",
  "optimizing",
  "deploying",
  "active",
  "failed",
  "cancelled",
  "rolled_back",
] as const;

export type RuntimeDeploymentStatus = (typeof RUNTIME_DEPLOYMENT_STATUSES)[number];

export type RuntimeLogLevel =
  | "info"
  | "warn"
  | "error"
  | "deploy"
  | "ok"
  | "debug";

export type RuntimeLogLine = {
  id: string;
  ts: number;
  level: RuntimeLogLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeJob = {
  id: string;
  projectId: string;
  projectName: string;
  branch: string;
  commitSha: string;
  status: RuntimeDeploymentStatus;
  /** Index into PHASE_SEQUENCE while not terminal. */
  phaseIndex: number;
  elapsedInPhaseMs: number;
  workerId: string | null;
  queuePosition: number;
  retryCount: number;
  /** Simulated previous deployment id for rollback narrative. */
  previousDeploymentId: string | null;
  cancelledRequested: boolean;
  rollbackRequested: boolean;
  /** Random seed for cache hit simulation (stable per job). */
  cacheSeed: number;
  createdAt: number;
  updatedAt: number;
};

export type RuntimeEngineConfig = {
  /** Max simultaneous deployments across the fleet. */
  maxConcurrentDeploys: number;
  /** Multiplier < 1 speeds phases up (UI demo). */
  phaseSpeed: number;
};

export type RuntimeEngineSnapshot = {
  jobs: RuntimeJob[];
  workers: DeploymentWorker[];
  config: RuntimeEngineConfig;
};

const PHASE_SEQUENCE: RuntimeDeploymentStatus[] = [
  "queued",
  "preparing",
  "cloning",
  "installing",
  "building",
  "optimizing",
  "deploying",
  "active",
];

/** Base duration per phase (ms), excluding terminal states. */
const PHASE_BASE_MS: Record<string, number> = {
  queued: 600,
  preparing: 900,
  cloning: 1200,
  installing: 1400,
  building: 1800,
  optimizing: 1000,
  deploying: 1100,
  active: 0,
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function logLine(
  level: RuntimeLogLevel,
  source: string,
  message: string,
  metadata?: Record<string, unknown>,
): RuntimeLogLine {
  return {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    level,
    source,
    message,
    metadata,
  };
}

export function isTerminalStatus(s: RuntimeDeploymentStatus): boolean {
  return s === "active" || s === "failed" || s === "cancelled" || s === "rolled_back";
}

export function isInflightRuntimeStatus(s: RuntimeDeploymentStatus): boolean {
  return !isTerminalStatus(s);
}

function phaseDurationMs(
  status: RuntimeDeploymentStatus,
  speed: number,
): number {
  const base = PHASE_BASE_MS[status] ?? 800;
  return Math.max(200, Math.round(base * speed));
}

function providerPrepLogs(job: RuntimeJob): RuntimeLogLine[] {
  return [
    logLine("info", "runtime_orchestrator", "Runtime profile: docker + edge (foundation)", {
      deployment_id: job.id,
      coolify: "adapter stub",
      dokploy: "adapter stub",
      hetzner: "vps adapter stub",
    }),
    logLine(
      "debug",
      "docker_runtime",
      "Docker image context prepared (simulated pull policy: if-not-present)",
      { deployment_id: job.id },
    ),
    logLine(
      "info",
      "vps_planner",
      "VPS placement: deferred — edge-first rollout (Hetzner pool standby)",
      { deployment_id: job.id, region_hint: "eu-central" },
    ),
  ];
}

function phaseEnterLogs(job: RuntimeJob, status: RuntimeDeploymentStatus): RuntimeLogLine[] {
  const lines: RuntimeLogLine[] = [];
  switch (status) {
    case "queued":
      lines.push(
        logLine("info", "deployment_queue", "Job accepted into deployment queue", {
          deployment_id: job.id,
          concurrency_slot: "pending",
        }),
      );
      break;
    case "preparing":
      lines.push(...providerPrepLogs(job));
      lines.push(
        logLine("deploy", "build_runner", "Provisioning build workspace & secrets mount", {
          deployment_id: job.id,
        }),
      );
      break;
    case "cloning":
      lines.push(
        logLine("deploy", "git_runner", `Cloning ${job.branch} @ ${job.commitSha}`, {
          deployment_id: job.id,
        }),
      );
      break;
    case "installing": {
      const hit = job.cacheSeed % 100 < 72;
      lines.push(
        logLine(
          hit ? "ok" : "info",
          "build_cache",
          hit
            ? `Dependency layer cache HIT (${(job.cacheSeed % 40) + 60}% reuse)`
            : "Dependency layer cache MISS — cold resolve",
          { deployment_id: job.id, cache_simulation: true },
        ),
      );
      lines.push(
        logLine("deploy", "build_runner", "Installing dependencies (pnpm/npm simulated)", {
          deployment_id: job.id,
        }),
      );
      break;
    }
    case "building":
      lines.push(
        logLine("deploy", "build_runner", "Running production build", {
          deployment_id: job.id,
        }),
      );
      break;
    case "optimizing":
      lines.push(
        logLine("info", "artifact_store", "Uploading build artifact to object storage (sim)", {
          deployment_id: job.id,
          bytes: 1_800_000 + (job.cacheSeed % 500_000),
        }),
      );
      lines.push(
        logLine("deploy", "edge_optimizer", "Edge bundle optimization & code splitting pass", {
          deployment_id: job.id,
        }),
      );
      break;
    case "deploying":
      lines.push(
        logLine("deploy", "edge_router", "Promoting revision to edge routers (canary: 0%)", {
          deployment_id: job.id,
        }),
      );
      break;
    case "active":
      lines.push(
        logLine("ok", "edge_router", "Deployment ACTIVE — traffic shifted to new revision", {
          deployment_id: job.id,
        }),
      );
      break;
    default:
      break;
  }
  return lines;
}

export type RuntimeEngineListener = (snap: RuntimeEngineSnapshot) => void;

export class RuntimeEngine {
  private jobs: RuntimeJob[] = [];
  private workers: DeploymentWorker[];
  private logs: Map<string, RuntimeLogLine[]> = new Map();
  private listeners = new Set<RuntimeEngineListener>();
  private config: RuntimeEngineConfig;

  constructor(config?: Partial<RuntimeEngineConfig>) {
    this.config = {
      maxConcurrentDeploys: config?.maxConcurrentDeploys ?? 2,
      phaseSpeed: config?.phaseSpeed ?? 0.55,
    };
    this.workers = cloneWorkers();
  }

  getConfig(): RuntimeEngineConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<RuntimeEngineConfig>) {
    this.config = { ...this.config, ...patch };
    this.emit();
  }

  subscribe(fn: RuntimeEngineListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) fn(snap);
  }

  getSnapshot(): RuntimeEngineSnapshot {
    return {
      jobs: this.jobs.map((j) => ({ ...j })),
      workers: this.workers.map((w) => ({ ...w })),
      config: { ...this.config },
    };
  }

  getLogs(jobId: string): RuntimeLogLine[] {
    return [...(this.logs.get(jobId) ?? [])];
  }

  private appendLogs(jobId: string, lines: RuntimeLogLine[]) {
    const cur = this.logs.get(jobId) ?? [];
    this.logs.set(jobId, [...cur, ...lines].slice(-400));
  }

  enqueue(input: {
    projectId: string;
    projectName: string;
    branch?: string;
    commitSha?: string;
    previousDeploymentId?: string | null;
    /** When set, increments retryCount from the prior job. */
    retryOf?: string | null;
  }): string {
    let retryCount = 0;
    let previousDeploymentId = input.previousDeploymentId ?? null;
    if (input.retryOf) {
      const prior = this.jobs.find((j) => j.id === input.retryOf);
      if (prior) {
        retryCount = prior.retryCount + 1;
        previousDeploymentId = prior.id;
      }
    }

    const id = newId();
    const job: RuntimeJob = {
      id,
      projectId: input.projectId,
      projectName: input.projectName,
      branch: input.branch ?? "main",
      commitSha: input.commitSha ?? randomSha(),
      status: "queued",
      phaseIndex: 0,
      elapsedInPhaseMs: 0,
      workerId: null,
      queuePosition: this.queuedJobs().length + 1,
      retryCount,
      previousDeploymentId,
      cancelledRequested: false,
      rollbackRequested: false,
      cacheSeed: Math.floor(Math.random() * 1_000_000),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.unshift(job);
    this.appendLogs(id, phaseEnterLogs(job, "queued"));
    this.recomputeQueuePositions();
    this.tryAssignQueue();
    this.emit();
    return id;
  }

  private queuedJobs(): RuntimeJob[] {
    return this.jobs.filter((j) => j.status === "queued" && !j.workerId);
  }

  private recomputeQueuePositions() {
    const queued = this.jobs
      .filter((j) => j.status === "queued" && !j.workerId)
      .sort((a, b) => b.createdAt - a.createdAt);
    let pos = 1;
    for (const j of queued) {
      j.queuePosition = pos;
      pos += 1;
    }
  }

  private tryAssignQueue() {
    const max = this.config.maxConcurrentDeploys;
    let running = busyWorkerCount(this.workers);

    const waiters = this.jobs
      .filter((j) => j.status === "queued" && !j.workerId)
      .sort((a, b) => b.createdAt - a.createdAt);

    for (const job of waiters) {
      if (running >= max) break;
      const w = pickWorkerForJob(this.workers, { needsBuild: true });
      if (!w) break;
      this.workers = assignWorker(this.workers, w.id, job.id);
      job.workerId = w.id;
      job.status = "preparing";
      job.phaseIndex = 1;
      job.elapsedInPhaseMs = 0;
      job.updatedAt = Date.now();
      this.appendLogs(job.id, [
        logLine("info", "deployment_worker", `Assigned to worker ${w.label} (${w.id})`, {
          deployment_id: job.id,
          worker_id: w.id,
          region: w.region,
        }),
        ...phaseEnterLogs(job, "preparing"),
      ]);
      running += 1;
    }
    this.recomputeQueuePositions();
  }

  /** Advance simulation by delta ms (call from rAF or interval). */
  tick(deltaMs: number) {
    const speed = this.config.phaseSpeed;
    let changed = false;

    for (const job of this.jobs) {
      if (!isInflightRuntimeStatus(job.status)) continue;
      if (job.status === "queued") continue;

      if (job.cancelledRequested && job.status !== "cancelled") {
        if (job.workerId) {
          this.workers = releaseWorker(this.workers, job.workerId);
        }
        job.workerId = null;
        job.status = "cancelled";
        job.updatedAt = Date.now();
        this.appendLogs(job.id, [
          logLine("warn", "deployment_queue", "Deployment CANCELLED by operator", {
            deployment_id: job.id,
          }),
        ]);
        changed = true;
        continue;
      }

      if (job.rollbackRequested && job.status === "active") {
        if (job.workerId) {
          this.workers = releaseWorker(this.workers, job.workerId);
        }
        job.workerId = null;
        job.status = "rolled_back";
        job.updatedAt = Date.now();
        this.appendLogs(job.id, [
          logLine("warn", "rollback_engine", "Rollback executed — previous revision restored (sim)", {
            deployment_id: job.id,
            previous: job.previousDeploymentId,
          }),
        ]);
        changed = true;
        continue;
      }

      const dur = phaseDurationMs(job.status, speed);
      job.elapsedInPhaseMs += deltaMs;
      job.updatedAt = Date.now();

      if (job.elapsedInPhaseMs < dur) {
        changed = true;
        continue;
      }

      // Phase complete — advance
      job.elapsedInPhaseMs = 0;

      const nextIdx = job.phaseIndex + 1;
      if (nextIdx >= PHASE_SEQUENCE.length) {
        if (job.workerId) {
          this.workers = releaseWorker(this.workers, job.workerId);
        }
        job.workerId = null;
        job.status = "active";
        job.phaseIndex = PHASE_SEQUENCE.length - 1;
        job.updatedAt = Date.now();
        this.appendLogs(job.id, phaseEnterLogs(job, "active"));
        changed = true;
        continue;
      }

      const nextStatus = PHASE_SEQUENCE[nextIdx]!;
      job.phaseIndex = nextIdx;
      job.status = nextStatus;
      job.updatedAt = Date.now();
      this.appendLogs(job.id, phaseEnterLogs(job, nextStatus));
      changed = true;
    }

    if (changed) {
      this.tryAssignQueue();
      this.emit();
    } else {
      this.tryAssignQueue();
    }
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || isTerminalStatus(job.status)) return false;
    job.cancelledRequested = true;
    job.updatedAt = Date.now();
    this.emit();
    return true;
  }

  /** Operator / circuit-breaker path — marks job failed and frees worker. */
  failDeployment(jobId: string, reason?: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || isTerminalStatus(job.status)) return false;
    if (job.workerId) {
      this.workers = releaseWorker(this.workers, job.workerId);
    }
    job.workerId = null;
    job.status = "failed";
    job.cancelledRequested = false;
    job.updatedAt = Date.now();
    this.appendLogs(job.id, [
      logLine("error", "runtime_orchestrator", reason ?? "Deployment marked FAILED (simulated breaker)", {
        deployment_id: job.id,
      }),
    ]);
    this.tryAssignQueue();
    this.emit();
    return true;
  }

  retry(jobId: string): string | null {
    const old = this.jobs.find((j) => j.id === jobId);
    if (!old || (old.status !== "failed" && old.status !== "cancelled")) return null;
    return this.enqueue({
      projectId: old.projectId,
      projectName: old.projectName,
      branch: old.branch,
      commitSha: randomSha(),
      retryOf: old.id,
    });
  }

  rollback(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== "active") return false;
    job.rollbackRequested = true;
    job.updatedAt = Date.now();
    this.emit();
    return true;
  }

  /** Remove terminal jobs older than maxKeep (optional housekeeping). */
  prune(maxKeep = 40) {
    const terminal = this.jobs.filter((j) => isTerminalStatus(j.status));
    if (terminal.length <= maxKeep) return;
    const sorted = terminal.sort((a, b) => b.updatedAt - a.updatedAt);
    const drop = sorted.slice(maxKeep);
    const dropIds = new Set(drop.map((d) => d.id));
    this.jobs = this.jobs.filter((j) => !dropIds.has(j.id));
    this.emit();
  }
}

function randomSha(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 7; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function cloneWorkers(): DeploymentWorker[] {
  return cloneWorkerFleet();
}
