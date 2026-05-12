/**
 * GTLNAV — legacy in-process deployment SIMULATOR.
 *
 * ⚠ DEV / DEMO ONLY — DO NOT IMPORT FROM CUSTOMER-FACING UI.
 *
 * This module pretends to deploy a project by writing fake phase strings into
 * the `deployments` table on a setTimeout schedule. It was the bootstrap path
 * before Phase 6A. The production deploy path is now:
 *
 *     UI → POST /api/deployments/start  (src/lib/deploy-client.ts)
 *        → deployment_jobs row inserted
 *        → external worker claims via POST /api/worker/claim-job
 *        → worker drives status through /api/worker/status + /logs
 *        → worker calls /api/worker/complete on success
 *
 * The two non-simulator exports — `INFLIGHT_STATUSES` and `isInflightStatus`
 * — are pure status helpers and safe to use anywhere. They are re-exported
 * here for back-compat; the canonical source is `@/src/lib/server-deployments`
 * (DEPLOYMENT_INFLIGHT_STATUSES / isInflight).
 *
 * `simulateDeployment` and the helper `startDeployment` keep working so we
 * can drive a fake deploy from a dev console or a Storybook story, but they
 * will refuse to run when GTLNAV_DISABLE_DEPLOYMENT_SIMULATOR is truthy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function simulatorDisabled(): boolean {
  // Public env flag is readable in the browser bundle so we can hard-block
  // the simulator from production builds even if a UI surface forgets.
  const flag =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GTLNAV_DISABLE_DEPLOYMENT_SIMULATOR
      : undefined;
  if (flag == null) return false;
  const v = String(flag).toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const INFLIGHT_STATUSES = [
  "queued",
  "cloning",
  "installing",
  "building",
  "optimizing",
  "deploying",
] as const;

export type InflightStatus = (typeof INFLIGHT_STATUSES)[number];

export function isInflightStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toString().toLowerCase();
  return (INFLIGHT_STATUSES as readonly string[]).includes(s);
}

type LogSpec = {
  level: string;
  message: string;
  source: string;
  metadata?: Record<string, unknown>;
};

type Phase = {
  status: InflightStatus | "active";
  /** ms to sleep BEFORE applying this phase. */
  delayMs: number;
  logs: LogSpec[];
};

const PHASES: Phase[] = [
  {
    status: "queued",
    delayMs: 0,
    logs: [
      {
        level: "info",
        message: "Deployment queued for build runner",
        source: "scheduler",
      },
    ],
  },
  {
    status: "cloning",
    delayMs: 1100,
    logs: [
      {
        level: "deploy",
        message: "Cloning repository",
        source: "git_runner",
      },
      {
        level: "info",
        message: "Repository cloned successfully",
        source: "git_runner",
      },
    ],
  },
  {
    status: "installing",
    delayMs: 1700,
    logs: [
      {
        level: "deploy",
        message: "Installing dependencies",
        source: "build_runner",
      },
    ],
  },
  {
    status: "building",
    delayMs: 2200,
    logs: [
      {
        level: "deploy",
        message: "Building application",
        source: "build_runner",
      },
    ],
  },
  {
    status: "optimizing",
    delayMs: 1500,
    logs: [
      {
        level: "deploy",
        message: "Optimizing assets",
        source: "edge_optimizer",
      },
      {
        level: "warn",
        message: "Cold start mitigation enabled",
        source: "edge_optimizer",
      },
    ],
  },
  {
    status: "deploying",
    delayMs: 1400,
    logs: [
      {
        level: "deploy",
        message: "Deploying to global edge network",
        source: "edge_router",
      },
    ],
  },
  {
    status: "active",
    delayMs: 1100,
    logs: [
      {
        level: "ok",
        message: "Deployment completed successfully",
        source: "edge_router",
      },
    ],
  },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortId(value: string): string {
  return value.replace(/-/g, "").slice(0, 6);
}

export function generateCommitSha(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 7; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function buildDeploymentUrl(slug: string | null | undefined, deploymentId: string) {
  const base = (slug ?? "app").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  return `https://${base || "app"}-${shortId(deploymentId)}.gtlnav.app`;
}

type InsertLogParams = {
  user_id: string;
  project_id: string;
  level: string;
  message: string;
  source: string;
  metadata: Record<string, unknown>;
  event_type: string;
};

async function insertLog(supabase: SupabaseClient, params: InsertLogParams) {
  const fullPayload = {
    user_id: params.user_id,
    project_id: params.project_id,
    event_type: params.event_type,
    level: params.level,
    severity: params.level,
    message: params.message,
    source: params.source,
    metadata: params.metadata,
  };

  const { error } = await supabase.from("infrastructure_logs").insert(fullPayload);
  if (!error) return;

  const minimalPayload = {
    user_id: params.user_id,
    project_id: params.project_id,
    event_type: params.event_type,
    severity: params.level,
    message: params.message,
  };
  const { error: fallbackError } = await supabase
    .from("infrastructure_logs")
    .insert(minimalPayload);
  if (fallbackError && process.env.NODE_ENV !== "production") {
    console.warn("infrastructure_logs insert failed:", fallbackError.message);
  }
}

export type SimulateDeploymentArgs = {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  deploymentId: string;
  projectName: string;
  projectSlug: string | null | undefined;
  /** Optional callback fired after each phase commit. */
  onPhase?: (status: string) => void;
  /** When true, abort early. Checked between phases. */
  shouldAbort?: () => boolean;
};

export async function simulateDeployment(args: SimulateDeploymentArgs): Promise<{
  deploymentUrl: string;
  ok: boolean;
}> {
  const {
    supabase,
    userId,
    projectId,
    deploymentId,
    projectName,
    projectSlug,
    onPhase,
    shouldAbort,
  } = args;

  if (simulatorDisabled()) {
    throw new Error(
      "deployment-simulator is disabled. Use startRealDeployment() from @/src/lib/deploy-client and let a real worker drive status.",
    );
  }

  const deploymentUrl = buildDeploymentUrl(projectSlug, deploymentId);

  for (const phase of PHASES) {
    if (phase.delayMs > 0) {
      await sleep(phase.delayMs);
    }
    if (shouldAbort?.()) {
      return { deploymentUrl, ok: false };
    }

    const isFinal = phase.status === "active";

    const deploymentUpdates: Record<string, unknown> = {
      status: phase.status,
    };
    if (isFinal) {
      deploymentUpdates.finished_at = new Date().toISOString();
      deploymentUpdates.deployment_url = deploymentUrl;
    }

    await supabase
      .from("deployments")
      .update(deploymentUpdates)
      .eq("id", deploymentId)
      .eq("user_id", userId);

    const projectUpdates: Record<string, unknown> = {
      status: isFinal ? "active" : "deploying",
    };
    if (isFinal) {
      projectUpdates.live_url = deploymentUrl;
    }
    await supabase
      .from("projects")
      .update(projectUpdates)
      .eq("id", projectId)
      .eq("user_id", userId);

    for (const log of phase.logs) {
      await insertLog(supabase, {
        user_id: userId,
        project_id: projectId,
        level: log.level,
        message: log.message,
        source: log.source,
        metadata: {
          ...(log.metadata ?? {}),
          deployment_id: deploymentId,
          phase: phase.status,
          project: projectName,
        },
        event_type: isFinal
          ? "deployment_completed"
          : `deployment_${phase.status}`,
      });
    }

    onPhase?.(phase.status);
  }

  return { deploymentUrl, ok: true };
}

export async function startDeployment(
  supabase: SupabaseClient,
  args: { userId: string; projectId: string; branch?: string },
): Promise<
  | { ok: true; deploymentId: string; commitSha: string }
  | { ok: false; error: string }
> {
  if (simulatorDisabled()) {
    return {
      ok: false,
      error:
        "deployment-simulator is disabled. Call startRealDeployment() from @/src/lib/deploy-client instead.",
    };
  }
  const branch = args.branch ?? "main";
  const commitSha = generateCommitSha();
  const startedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("deployments")
    .insert({
      user_id: args.userId,
      project_id: args.projectId,
      status: "queued",
      branch,
      commit_sha: commitSha,
      deployment_url: null,
      build_logs: "Build job queued by GTLNAV runtime.",
      started_at: startedAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    const fallbackPayload = {
      user_id: args.userId,
      project_id: args.projectId,
      status: "queued",
      branch,
      build_logs: "Build job queued by GTLNAV runtime.",
    };
    const fallback = await supabase
      .from("deployments")
      .insert(fallbackPayload)
      .select("id")
      .single();
    if (fallback.error || !fallback.data) {
      return {
        ok: false,
        error: (error ?? fallback.error)?.message ?? "Failed to queue deployment.",
      };
    }
    return { ok: true, deploymentId: fallback.data.id as string, commitSha };
  }

  return { ok: true, deploymentId: data.id as string, commitSha };
}
