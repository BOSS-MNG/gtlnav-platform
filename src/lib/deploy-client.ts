/**
 * GTLNAV — browser-side deployment trigger.
 *
 * Phase 6A: replaces the in-process `startDeployment` + `simulateDeployment`
 * pair from `src/lib/deployment-simulator.ts`. UI components should call
 * `startRealDeployment` instead, which:
 *
 *   1. Reads the current Supabase session and pulls the JWT.
 *   2. POSTs `/api/deployments/start` with `Authorization: Bearer <jwt>`.
 *   3. Returns the queued `deployment_id` + `job_id`.
 *
 * From then on, status flows are driven by the worker pushing into the
 * `deployments` + `deployment_jobs` tables; the UI just polls / re-reads
 * via the existing Supabase queries.
 *
 * No timers, no fake phase strings, no fake commit SHA, no fake URL.
 */
import { supabase } from "@/src/lib/supabase";

export type StartRealDeploymentArgs = {
  projectId: string;
  branch?: string;
  /** Optional commit SHA override. The control plane generates one if missing. */
  commitSha?: string;
  /** Optional target hint stored in payload (e.g. "static", "docker"). */
  deployTarget?: string | null;
  /** Optional environment overrides recorded on the deployment_jobs payload. */
  env?: Record<string, string | number | boolean> | null;
};

export type StartRealDeploymentResult =
  | {
      ok: true;
      deploymentId: string;
      jobId: string | null;
      status: string;
      branch: string;
      commitSha: string;
      /** Set when the deployment_jobs table is not provisioned yet. */
      warning?: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      status: number;
    };

const START_ROUTE = "/api/deployments/start";

export async function startRealDeployment(
  args: StartRealDeploymentArgs,
): Promise<StartRealDeploymentResult> {
  const projectId = args.projectId?.trim();
  if (!projectId) {
    return {
      ok: false,
      error: "missing_project_id",
      message: "projectId is required.",
      status: 400,
    };
  }

  const {
    data: { session },
    error: sessionErr,
  } = await supabase.auth.getSession();

  if (sessionErr) {
    return {
      ok: false,
      error: "session_lookup_failed",
      message: sessionErr.message,
      status: 401,
    };
  }
  const jwt = session?.access_token;
  if (!jwt) {
    return {
      ok: false,
      error: "missing_session",
      message: "You are not signed in. Refresh the page and try again.",
      status: 401,
    };
  }

  const body: Record<string, unknown> = {
    project_id: projectId,
    branch: args.branch ?? "main",
  };
  if (args.commitSha) body.commit_sha = args.commitSha;
  if (args.deployTarget !== undefined) body.deploy_target = args.deployTarget;
  if (args.env) body.env = args.env;

  let resp: Response;
  try {
    resp = await fetch(START_ROUTE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Network request failed.",
      status: 0,
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await resp.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!resp.ok && resp.status !== 202) {
    return {
      ok: false,
      error: (payload.error as string) ?? `http_${resp.status}`,
      message:
        (payload.message as string) ??
        `Control plane returned ${resp.status}.`,
      status: resp.status,
    };
  }

  return {
    ok: true,
    deploymentId: String(payload.deployment_id ?? ""),
    jobId:
      payload.job_id == null || payload.job_id === ""
        ? null
        : String(payload.job_id),
    status: String(payload.status ?? "queued"),
    branch: String(payload.branch ?? args.branch ?? "main"),
    commitSha: String(payload.commit_sha ?? ""),
    warning:
      typeof payload.warning === "string" && payload.warning.length > 0
        ? payload.warning
        : undefined,
  };
}

/**
 * Convenience helper for components that have always called the *Bearer*
 * route shape via the access token. Re-exported here so call sites can
 * import a single module.
 */
export async function verifyDomainViaApi(args: {
  domainId: string;
}): Promise<
  | {
      ok: true;
      verified: boolean;
      mutated: boolean;
      domain_id: string;
      domain: string;
      status: string | null;
      ssl_status: string | null;
      verified_at: string | null;
      result: unknown;
      instructions: unknown;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
      status: number;
      result?: unknown;
      instructions?: unknown;
    }
> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) {
    return {
      ok: false,
      error: "missing_session",
      message: "You are not signed in. Refresh the page and try again.",
      status: 401,
    };
  }

  let resp: Response;
  try {
    resp = await fetch(`/api/domains/${encodeURIComponent(args.domainId)}/verify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: "network_error",
      message: err instanceof Error ? err.message : "Network request failed.",
      status: 0,
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await resp.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: (payload.error as string) ?? `http_${resp.status}`,
      message:
        (payload.message as string) ??
        `Domain verification failed (${resp.status}).`,
      status: resp.status,
      result: payload.result,
      instructions: payload.instructions,
    };
  }

  if (payload.verified === false) {
    return {
      ok: false,
      error: (payload.error as string) ?? "dns_not_matched",
      message:
        (payload.message as string) ??
        "DNS did not match the expected GTLNAV target. Update your record and try again.",
      status: 200,
      result: payload.result,
      instructions: payload.instructions,
    };
  }

  return {
    ok: true,
    verified: payload.verified === true,
    mutated: payload.mutated === true,
    domain_id: String(payload.domain_id ?? args.domainId),
    domain: String(payload.domain ?? ""),
    status: (payload.status as string) ?? null,
    ssl_status: (payload.ssl_status as string) ?? null,
    verified_at: (payload.verified_at as string) ?? null,
    result: payload.result,
    instructions: payload.instructions,
    message:
      typeof payload.message === "string" ? (payload.message as string) : undefined,
  };
}
