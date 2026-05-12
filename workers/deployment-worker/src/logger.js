/**
 * GTLNAV deployment-worker — log batcher.
 *
 * Buffers log lines for a single job and flushes them to /api/worker/logs
 * every ~500ms or when the buffer fills, whichever comes first. Logs are
 * also echoed to local stderr so a dev tail-ing the worker can see them.
 *
 * Sanitization rules (applied per line, in order):
 *   1. Trim trailing whitespace.
 *   2. Truncate lines longer than 4 KB to keep the audit ledger sane.
 *   3. Redact any token that looks like a secret (env var name → "***").
 */
import { postLogs } from "./api.js";
import { config } from "./config.js";

const MAX_LINE_BYTES = 4 * 1024;
const FLUSH_INTERVAL_MS = 500;
const FLUSH_AT_LINES = 25;

/**
 * @param {string} line
 * @param {string[]} secretValues — concrete env values to redact (never names).
 */
function sanitize(line, secretValues) {
  let s = String(line ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  s = s.replace(/\s+$/g, "");
  for (const v of secretValues) {
    if (!v || v.length < 4) continue;
    // Replace the literal value with a fixed mask. We do not regex-escape
    // beyond what's safe to keep this cheap; secrets containing regex
    // metacharacters are rare in practice.
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(escaped, "g"), "***");
  }
  if (Buffer.byteLength(s, "utf8") > MAX_LINE_BYTES) {
    const buf = Buffer.from(s, "utf8");
    s = `${buf.subarray(0, MAX_LINE_BYTES).toString("utf8")}… (truncated)`;
  }
  return s;
}

export function createJobLogger(jobId, secretValues = []) {
  const queue = [];
  let totalBytes = 0;
  let flushing = false;
  let timer = null;

  async function flush() {
    if (flushing) return;
    if (queue.length === 0) return;
    flushing = true;
    const batch = queue.splice(0, queue.length);
    try {
      const { ok, payload } = await postLogs(jobId, batch);
      if (!ok) {
        process.stderr.write(
          `[worker] log batch rejected: ${payload?.message ?? "unknown"}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `[worker] log batch error: ${err instanceof Error ? err.message : err}\n`,
      );
    } finally {
      flushing = false;
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  }

  function push(level, source, message) {
    if (totalBytes >= config.maxLogBytes) return;
    const sanitized = sanitize(message, secretValues);
    if (!sanitized) return;
    queue.push({ level, source, message: sanitized });
    totalBytes += Buffer.byteLength(sanitized, "utf8");

    // Mirror to local stderr for live dev tails.
    const prefix = `[${level}] [${source}]`;
    process.stderr.write(`${prefix} ${sanitized}\n`);

    if (queue.length >= FLUSH_AT_LINES) void flush();
    else schedule();
  }

  return {
    info: (msg, source = "worker") => push("info", source, msg),
    warn: (msg, source = "worker") => push("warning", source, msg),
    error: (msg, source = "worker") => push("error", source, msg),
    success: (msg, source = "worker") => push("success", source, msg),
    pushRaw: (line, source = "build") => push("info", source, line),
    async drain() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}
