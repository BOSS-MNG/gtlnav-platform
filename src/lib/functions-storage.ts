import type { EdgeFunction, FunctionDeployment, FunctionLog } from "@/src/lib/edge-functions";

export const FUNCTIONS_STORE_KEY = "gtlnav.edge_functions.v1";

export type FunctionsStoredState = {
  userId: string;
  fns: EdgeFunction[];
  deployments: FunctionDeployment[];
  logs: FunctionLog[];
};

export function readFunctionsStore(userId: string): FunctionsStoredState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FUNCTIONS_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FunctionsStoredState;
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeFunctionsStore(s: FunctionsStoredState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FUNCTIONS_STORE_KEY,
      JSON.stringify({
        userId: s.userId,
        fns: s.fns,
        deployments: s.deployments.slice(0, 80),
        logs: s.logs.slice(0, 400),
      }),
    );
  } catch {
    /* no-op */
  }
}

export function mergeFunctionSlice(
  userId: string,
  fn: EdgeFunction,
  fnDeployments: FunctionDeployment[],
  fnLogs: FunctionLog[],
) {
  const s =
    readFunctionsStore(userId) ?? ({
      userId,
      fns: [],
      deployments: [],
      logs: [],
    } satisfies FunctionsStoredState);
  const has = s.fns.some((f) => f.id === fn.id);
  const fns = has ? s.fns.map((f) => (f.id === fn.id ? fn : f)) : [fn, ...s.fns];
  const depOthers = s.deployments.filter((d) => d.function_id !== fn.id);
  const deployments = [...fnDeployments, ...depOthers].slice(0, 80);
  const logOthers = s.logs.filter((l) => l.function_id !== fn.id);
  const logs = [...fnLogs, ...logOthers].slice(0, 400);
  writeFunctionsStore({ userId, fns, deployments, logs });
}
