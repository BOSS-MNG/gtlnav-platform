#!/usr/bin/env node
/**
 * GTLNAV deployment-worker — main loop.
 *
 * Long-running process that:
 *   1. polls /api/worker/claim-job
 *   2. when a job appears, drives it through:
 *        claimed → cloning → installing → building → deploying → running
 *      and pushes logs + status updates to the control plane
 *   3. publishes the static build into $DEPLOYMENTS_ROOT/<slug>/<deployment_id>
 *      and points $DEPLOYMENTS_ROOT/<slug>/current at it
 *   4. on success, calls /api/worker/complete with the live URL
 *   5. on failure, calls /api/worker/fail with the error message
 *
 * Set GTLNAV_WORKER_RUN_ONCE=1 to make this a one-shot worker (good for
 * CI smoke tests). Otherwise it runs until SIGINT / SIGTERM.
 */
import { config } from "./config.js";
import {
  claimNextJob,
  postComplete,
  postFail,
  postStatus,
} from "./api.js";
import { createJobLogger } from "./logger.js";
import { runBuild } from "./build.js";
import { runRuntimeAction } from "./runtime-action.js";

let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function announce(message) {
  process.stdout.write(`[worker] ${message}\n`);
}

async function runJob(job) {
  const logger = createJobLogger(job.id, [
    config.workerSecret,
    config.githubToken ?? "",
  ].filter(Boolean));

  const kind = job.payload?.kind ?? "deploy";

  // Branch on the payload kind. Backward-compat: any job without an explicit
  // kind is treated as a build/deploy.
  if (kind === "runtime_action") {
    logger.info(
      `Worker "${config.workerLabel}" claimed runtime_action job ${job.id} (${job.payload?.action ?? "?"} on ${job.payload?.container_name ?? job.payload?.runtime_instance_id ?? "?"}).`,
      "runner",
    );
    await postStatus(job.id, "running", "running");

    let result;
    try {
      result = await runRuntimeAction({ job, logger });
    } catch (err) {
      result = {
        ok: false,
        stage: "unhandled",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    await logger.drain();
    if (!result.ok) {
      await postFail(job.id, result.errorMessage, { stage: result.stage });
      return;
    }
    await postComplete(job.id, null, {
      action: result.action,
      container_name: result.containerName,
      duration_ms: result.durationMs ?? 0,
    });
    return;
  }

  // Default: deployment build.
  logger.info(
    `Worker "${config.workerLabel}" claimed deployment job ${job.id} (deployment ${job.deployment_id}).`,
    "runner",
  );

  // 1. cloning → keep the deployment phase honest.
  await postStatus(job.id, "cloning", "running");

  let result;
  try {
    result = await runBuild({ job, logger });
  } catch (err) {
    result = {
      ok: false,
      stage: "unhandled",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (!result.ok) {
    logger.error(`${result.stage}: ${result.errorMessage}`, "runner");
    await logger.drain();
    await postFail(job.id, result.errorMessage, { stage: result.stage });
    return;
  }

  // 2. deploying → static publish or docker run finished; proxy reload may
  //    take a moment. Surface that state.
  await postStatus(job.id, "deploying");
  await postStatus(job.id, "running");

  logger.success(
    `Deployment completed in ${result.durationMs}ms (${result.framework}, ${result.hostingKind ?? "static"}).`,
    "runner",
  );
  await logger.drain();

  await postComplete(job.id, result.deploymentUrl, {
    duration_ms: result.durationMs,
    framework: result.framework,
    artifact_path: result.artifactPath,
    hosting_kind: result.hostingKind ?? "static",
    internal_port: result.internalPort ?? null,
    container_name: result.containerName ?? null,
    image_tag: result.imageTag ?? null,
  });
}

async function tickOnce() {
  const claim = await claimNextJob();
  if (claim.kind === "queue_unprovisioned") {
    announce(
      `Deployment queue is not provisioned yet. Apply supabase/migrations/0003_deployments_and_queue.sql and try again.`,
    );
    return { idle: true };
  }
  if (claim.kind === "auth_error") {
    announce(`Auth error from control plane: ${claim.message}`);
    return { idle: true };
  }
  if (claim.kind === "error") {
    announce(`Claim error: ${claim.message}`);
    return { idle: true };
  }
  if (claim.kind === "empty") {
    return { idle: true };
  }
  await runJob(claim.job);
  return { idle: false };
}

async function loop() {
  announce(
    `gtlnav-deployment-worker starting. label=${config.workerLabel} app=${config.appUrl} deployments_root=${config.deploymentsRoot}`,
  );

  // One-shot mode for CI / smoke tests.
  if (config.runOnce) {
    await tickOnce();
    return;
  }

  while (!stopping) {
    let idle = true;
    try {
      const r = await tickOnce();
      idle = r.idle;
    } catch (err) {
      announce(`Tick error: ${err instanceof Error ? err.message : err}`);
    }
    if (idle) {
      await sleep(config.pollIntervalMs);
    } else {
      // Right after finishing a job, ask again immediately in case more
      // jobs are queued for this tenant.
      await sleep(250);
    }
  }
  announce("gtlnav-deployment-worker stopped.");
}

function handleShutdown(signal) {
  if (stopping) return;
  stopping = true;
  announce(`Received ${signal} — finishing current tick and exiting.`);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

loop().catch((err) => {
  announce(`Fatal: ${err instanceof Error ? err.stack ?? err.message : err}`);
  process.exitCode = 1;
});
