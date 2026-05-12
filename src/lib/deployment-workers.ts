/**
 * GTLNAV deployment worker pool (foundation).
 *
 * Models build runners / edge agents that will later map to Docker hosts,
 * Coolify/Dokploy targets, or Hetzner VPS instances. No real orchestration yet.
 */

export type WorkerCapability = "docker" | "vps" | "build" | "edge";

export type DeployTarget = "coolify" | "dokploy" | "docker" | "hetzner_vps" | "edge";

export type DeploymentWorker = {
  id: string;
  label: string;
  region: string;
  /** Planned integrations (Coolify, Dokploy, raw Docker, VPS). */
  targets: DeployTarget[];
  capabilities: WorkerCapability[];
  status: "idle" | "busy";
  currentJobId: string | null;
};

/** Default fleet shape — swap for real inventory later. */
export const DEFAULT_WORKER_FLEET: DeploymentWorker[] = [
  {
    id: "wrk-eu-1",
    label: "EU Build Pool A",
    region: "eu-west",
    targets: ["coolify", "docker"],
    capabilities: ["docker", "build"],
    status: "idle",
    currentJobId: null,
  },
  {
    id: "wrk-us-1",
    label: "US Build Pool A",
    region: "us-east",
    targets: ["dokploy", "docker"],
    capabilities: ["docker", "build", "edge"],
    status: "idle",
    currentJobId: null,
  },
  {
    id: "wrk-vps-1",
    label: "Hetzner VPS Edge",
    region: "eu-central",
    targets: ["hetzner_vps", "docker"],
    capabilities: ["vps", "docker", "build"],
    status: "idle",
    currentJobId: null,
  },
  {
    id: "wrk-edge-1",
    label: "Global Edge Promoter",
    region: "multi",
    targets: ["docker", "edge"],
    capabilities: ["edge", "docker"],
    status: "idle",
    currentJobId: null,
  },
];

export function cloneWorkerFleet(): DeploymentWorker[] {
  return DEFAULT_WORKER_FLEET.map((w) => ({
    ...w,
    status: "idle" as const,
    currentJobId: null,
  }));
}

export function pickWorkerForJob(
  workers: DeploymentWorker[],
  opts: { needsVps?: boolean; needsBuild?: boolean },
): DeploymentWorker | null {
  const idle = workers.filter((w) => w.status === "idle");
  if (idle.length === 0) return null;

  const scored = idle.map((w) => {
    let score = 0;
    if (opts.needsBuild && w.capabilities.includes("build")) score += 3;
    if (opts.needsVps && w.capabilities.includes("vps")) score += 4;
    if (w.capabilities.includes("docker")) score += 1;
    if (w.capabilities.includes("edge")) score += 0.5;
    return { w, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.w ?? idle[0] ?? null;
}

export function assignWorker(
  workers: DeploymentWorker[],
  workerId: string,
  jobId: string,
): DeploymentWorker[] {
  return workers.map((w) =>
    w.id === workerId
      ? { ...w, status: "busy" as const, currentJobId: jobId }
      : w,
  );
}

export function releaseWorker(
  workers: DeploymentWorker[],
  workerId: string,
): DeploymentWorker[] {
  return workers.map((w) =>
    w.id === workerId
      ? { ...w, status: "idle" as const, currentJobId: null }
      : w,
  );
}

export function workerById(
  workers: DeploymentWorker[],
  id: string,
): DeploymentWorker | undefined {
  return workers.find((w) => w.id === id);
}

export function busyWorkerCount(workers: DeploymentWorker[]): number {
  return workers.filter((w) => w.status === "busy").length;
}
