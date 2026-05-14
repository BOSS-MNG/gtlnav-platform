#!/usr/bin/env node
/**
 * GTLNAV production deploy webhook listener.
 *
 * Temporary architecture (current):
 *   GitHub Webhook -> public port 9000 -> this process -> deploy.sh -> PM2 reload
 *
 * Future hardened architecture:
 *   GitHub Webhook -> nginx HTTPS reverse proxy -> 127.0.0.1:9000 -> this process
 *
 * Why both modes are documented:
 * - The current VPS flow already exists in the wild and must not be broken.
 * - Port 9000 is intentionally kept as a temporary public ingress during bring-up.
 * - Once nginx is in front, this process should bind loopback only and port 9000
 *   should be closed in the firewall.
 *
 * Security guarantees in this file:
 * - rejects unsigned requests (`X-Hub-Signature-256` required)
 * - rejects invalid HMAC signatures using timing-safe comparison
 * - only accepts pushes for `GODTECHLABS/gtlnav-platform`
 * - only accepts `refs/heads/main`
 * - never logs the webhook secret or signature header value
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const WEBHOOK_SECRET = process.env.GTLNAV_WEBHOOK_SECRET ?? "";
const HOST = process.env.GTLNAV_DEPLOY_WEBHOOK_HOST ?? "0.0.0.0";
const PORT = Number.parseInt(process.env.GTLNAV_DEPLOY_WEBHOOK_PORT ?? "9000", 10);
const WEBHOOK_PATH = process.env.GTLNAV_DEPLOY_WEBHOOK_PATH ?? "/hooks/gtlnav-deploy";
const ALLOWED_REPO =
  (process.env.GTLNAV_ALLOWED_GITHUB_REPO ?? "GODTECHLABS/gtlnav-platform").trim().toLowerCase();
const ALLOWED_REF =
  (process.env.GTLNAV_ALLOWED_GITHUB_REF ?? "refs/heads/main").trim().toLowerCase();
const DEPLOY_SCRIPT =
  process.env.GTLNAV_DEPLOY_SCRIPT ??
  path.resolve(process.cwd(), "infra/production/deploy.sh");
const MAX_BODY_BYTES = Number.parseInt(
  process.env.GTLNAV_DEPLOY_MAX_BODY_BYTES ?? "1048576",
  10,
);

if (!WEBHOOK_SECRET) {
  console.error("[gtlnav/deploy-webhook] GTLNAV_WEBHOOK_SECRET is required.");
  process.exit(1);
}

if (!Number.isFinite(PORT) || PORT <= 0) {
  console.error(
    `[gtlnav/deploy-webhook] Invalid GTLNAV_DEPLOY_WEBHOOK_PORT: ${process.env.GTLNAV_DEPLOY_WEBHOOK_PORT ?? ""}`,
  );
  process.exit(1);
}

try {
  accessSync(DEPLOY_SCRIPT, constants.X_OK);
} catch {
  console.error(
    `[gtlnav/deploy-webhook] Deploy script is missing or not executable: ${DEPLOY_SCRIPT}`,
  );
  process.exit(1);
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function safeLog(message, details = {}) {
  const stamped = new Date().toISOString();
  console.log(`[${stamped}] [gtlnav/deploy-webhook] ${message}`, details);
}

function verifyGithubSignature(rawBody, headerValue) {
  const sig = (headerValue ?? "").trim();
  const match = /^sha256=([0-9a-f]{64})$/i.exec(sig);
  if (!match) return false;

  const received = Buffer.from(match[1].toLowerCase(), "hex");
  const expected = createHmac("sha256", Buffer.from(WEBHOOK_SECRET, "utf8"))
    .update(rawBody)
    .digest();

  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function spawnDeploy(payload, headers) {
  const child = spawn(DEPLOY_SCRIPT, [], {
    cwd: process.env.GTLNAV_DEPLOY_APP_DIR ?? process.cwd(),
    env: {
      ...process.env,
      GTLNAV_WEBHOOK_EVENT: String(headers["x-github-event"] ?? "unknown"),
      GTLNAV_WEBHOOK_DELIVERY: String(headers["x-github-delivery"] ?? ""),
      GTLNAV_WEBHOOK_COMMIT_SHA:
        typeof payload.after === "string" ? payload.after : "",
      GTLNAV_WEBHOOK_REF:
        typeof payload.ref === "string" ? payload.ref : "",
      GTLNAV_WEBHOOK_REPOSITORY:
        typeof payload?.repository?.full_name === "string"
          ? payload.repository.full_name
          : "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  child.on("exit", (code, signal) => {
    safeLog("deploy process exited", {
      code,
      signal,
      delivery: headers["x-github-delivery"] ?? null,
      ref: payload.ref ?? null,
      commit: payload.after ?? null,
    });
  });

  return child.pid;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return json(res, 200, {
      ok: true,
      service: "gtlnav-deploy-webhook",
      mode: "temporary_public_port_9000",
      future_mode: "nginx_https_reverse_proxy_to_loopback",
      time: new Date().toISOString(),
    });
  }

  if (req.method !== "POST" || url.pathname !== WEBHOOK_PATH) {
    return json(res, 404, { ok: false, error: "not_found" });
  }

  const sigHeader = req.headers["x-hub-signature-256"];
  if (!sigHeader || Array.isArray(sigHeader)) {
    safeLog("rejected unsigned webhook", {
      ip: req.socket.remoteAddress ?? null,
      path: url.pathname,
    });
    return json(res, 401, {
      ok: false,
      error: "missing_signature",
      message: "X-Hub-Signature-256 is required.",
    });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      return json(res, 413, {
        ok: false,
        error: "payload_too_large",
        message: "Webhook payload exceeds the configured limit.",
      });
    }
    return json(res, 400, {
      ok: false,
      error: "body_read_failed",
      message: "Failed to read request body.",
    });
  }

  if (!verifyGithubSignature(rawBody, sigHeader)) {
    safeLog("rejected invalid webhook signature", {
      ip: req.socket.remoteAddress ?? null,
      path: url.pathname,
      has_signature: true,
    });
    return json(res, 401, {
      ok: false,
      error: "invalid_signature",
      message: "X-Hub-Signature-256 did not match the request body.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return json(res, 400, {
      ok: false,
      error: "invalid_json",
      message: "Webhook body is not valid JSON.",
    });
  }

  const githubEvent = String(req.headers["x-github-event"] ?? "").toLowerCase();
  if (githubEvent === "ping") {
    safeLog("acknowledged github ping", {
      delivery: req.headers["x-github-delivery"] ?? null,
    });
    return json(res, 200, { ok: true, event: "ping" });
  }

  const repository = String(payload?.repository?.full_name ?? "").toLowerCase();
  if (repository !== ALLOWED_REPO) {
    safeLog("rejected wrong repository", {
      delivery: req.headers["x-github-delivery"] ?? null,
      repository,
    });
    return json(res, 403, {
      ok: false,
      error: "repository_not_allowed",
      message: `Only ${ALLOWED_REPO} is allowed to trigger deployments.`,
    });
  }

  const ref = String(payload?.ref ?? "").toLowerCase();
  if (ref !== ALLOWED_REF) {
    safeLog("rejected wrong branch", {
      delivery: req.headers["x-github-delivery"] ?? null,
      ref,
    });
    return json(res, 403, {
      ok: false,
      error: "branch_not_allowed",
      message: `Only ${ALLOWED_REF} is allowed to trigger deployments.`,
    });
  }

  const pid = spawnDeploy(payload, req.headers);
  const commit = String(payload?.after ?? "");
  const time = new Date().toISOString();
  safeLog("accepted deploy webhook", {
    delivery: req.headers["x-github-delivery"] ?? null,
    repo: repository,
    ref,
    commit,
    pid,
  });

  return json(res, 202, {
    ok: true,
    status: "accepted",
    repository,
    ref,
    commit,
    pid,
    time,
  });
});

server.listen(PORT, HOST, () => {
  safeLog("listening", {
    host: HOST,
    port: PORT,
    path: WEBHOOK_PATH,
    repository: ALLOWED_REPO,
    ref: ALLOWED_REF,
  });
});
