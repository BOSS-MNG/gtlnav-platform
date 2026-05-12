/**
 * GTLNAV worker — HTTP health checker.
 *
 * Used after `docker run` to confirm the container actually came up.
 * Stops early on first 2xx/3xx; reports back the last seen state so the
 * dashboard can show "starting → healthy → unhealthy".
 *
 * Uses plain `http`/`https` so we don't pull a dependency.
 */
import http from "node:http";
import { config } from "./config.js";

function probeOnce({ host, port, path: probePath, timeoutMs }) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        path: probePath || "/",
        method: "GET",
        timeout: timeoutMs,
        // Don't follow redirects — a 3xx is success ("the app is answering").
      },
      (res) => {
        // Drain response so the socket frees up.
        res.resume();
        resolve({ ok: true, status: res.statusCode ?? 0 });
      },
    );
    req.on("error", (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
      resolve({ ok: false, status: 0, error: "timeout" });
    });
    req.end();
  });
}

export async function waitForHealthy({
  port,
  path: probePath = "/",
  host = "127.0.0.1",
  totalTimeoutMs = config.healthTimeoutMs,
  attemptIntervalMs = config.healthAttemptIntervalMs,
  attemptTimeoutMs = 4_000,
  logger,
}) {
  const deadline = Date.now() + totalTimeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const r = await probeOnce({
      host,
      port,
      path: probePath,
      timeoutMs: attemptTimeoutMs,
    });
    if (r.ok && r.status > 0 && r.status < 500) {
      return { ok: true, status: r.status, lastError: null };
    }
    lastError = r.error ?? `status ${r.status}`;
    if (logger) {
      logger.info(
        `Health probe to http://${host}:${port}${probePath} → ${lastError}`,
        "health",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, attemptIntervalMs));
  }
  return { ok: false, status: 0, lastError: lastError ?? "exhausted" };
}
