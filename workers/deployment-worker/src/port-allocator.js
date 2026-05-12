/**
 * GTLNAV worker — internal-port allocator.
 *
 * Containers expose their HTTP server on a worker-local TCP port the
 * reverse proxy can target with `reverse_proxy 127.0.0.1:<port>`. We pick
 * a free port inside the configured window by performing an actual bind on
 * the loopback interface — the only authoritative way to know it's free.
 */
import net from "node:net";
import { config } from "./config.js";

const inFlight = new Set();

function bindCheck(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      try {
        server.close();
      } catch {
        /* noop */
      }
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Allocate a free port. Caller must release it (or start a container on
 * it) before the next allocation, since we re-test for liveness anyway.
 *
 * @returns {Promise<number>}
 */
export async function allocatePort() {
  const min = Math.max(1024, config.runtimePortMin || 34000);
  const max = Math.min(65535, config.runtimePortMax || 34999);
  if (min > max) {
    throw new Error(
      `Invalid runtime port window: min ${min} > max ${max}. Check GTLNAV_RUNTIME_PORT_{MIN,MAX}.`,
    );
  }
  const tried = new Set();
  const total = max - min + 1;
  // Randomize starting offset so two workers don't always race the same port.
  let start = min + Math.floor(Math.random() * total);
  for (let i = 0; i < total; i++) {
    const port = ((start - min + i) % total) + min;
    if (tried.has(port) || inFlight.has(port)) continue;
    tried.add(port);
    const free = await bindCheck(port);
    if (free) {
      inFlight.add(port);
      // Drop the in-flight reservation after a short window — long enough
      // for `docker run -p` to claim it.
      setTimeout(() => inFlight.delete(port), 30_000).unref?.();
      return port;
    }
  }
  throw new Error(
    `No free ports in window ${min}-${max}. Increase GTLNAV_RUNTIME_PORT_MAX.`,
  );
}

export function releasePort(port) {
  if (typeof port === "number") inFlight.delete(port);
}
