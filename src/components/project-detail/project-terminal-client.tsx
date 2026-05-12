"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";
import { TerminalIcon } from "@/src/components/ui/icons";

type LogTab = "deployment" | "runtime" | "system";

export type TerminalLogLine = {
  id: string;
  created_at: string | null;
  severity: string | null;
  event_type: string | null;
  message: string | null;
  source: string | null;
};

function tabLabel(tab: LogTab): string {
  switch (tab) {
    case "deployment":
      return "Deployment Logs";
    case "runtime":
      return "Runtime Logs";
    case "system":
      return "System Logs";
    default:
      return tab;
  }
}

function buildStreamUrl(projectId: string, tab: LogTab): string {
  const params = new URLSearchParams();
  params.set("project_id", projectId);
  params.set("limit", "100");
  if (tab === "deployment") params.set("event_type_prefix", "deployment_");
  else if (tab === "runtime") params.set("event_type_prefix", "runtime_");
  return `/api/logs/stream?${params.toString()}`;
}

/**
 * Minimal SSE frame parser for fetch() streaming bodies.
 * Handles `event:`, `id:`, `data:` (multi-line), comment lines, and blank-line delimiters.
 */
function parseSseFrames(
  buffer: string,
): { events: Array<{ event: string; id: string | null; data: string }>; rest: string } {
  const events: Array<{ event: string; id: string | null; data: string }> = [];
  let rest = buffer;
  while (true) {
    const sep = rest.indexOf("\n\n");
    if (sep < 0) break;
    const raw = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    if (!raw.trim()) continue;
    let event = "message";
    let id: string | null = null;
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5));
    }
    events.push({ event, id, data: dataLines.join("\n") });
  }
  return { events, rest };
}

export function ProjectTerminalClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<LogTab>("deployment");
  const [lines, setLines] = useState<TerminalLogLine[]>([]);
  const [filterText, setFilterText] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [connection, setConnection] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");

  const filteredLines = useMemo(() => {
    const ft = filterText.trim().toLowerCase();
    const sev = severityFilter.trim().toLowerCase();
    return lines.filter((line) => {
      if (sev) {
        const s = (line.severity ?? "").toLowerCase();
        if (!s.includes(sev)) return false;
      }
      if (!ft) return true;
      const hay = [
        line.message ?? "",
        line.event_type ?? "",
        line.severity ?? "",
        line.source ?? "",
        line.created_at ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(ft);
    });
  }, [lines, filterText, severityFilter]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      if (!s) {
        router.replace("/login");
        return;
      }
      setSession(s);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      if (!next) {
        router.replace("/login");
        return;
      }
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("name, slug")
        .eq("id", projectId)
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setProjectName(null);
        setProjectSlug(null);
        return;
      }
      setProjectName((data as { name?: string | null }).name ?? null);
      setProjectSlug((data as { slug?: string | null }).slug ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, projectId]);

  const appendLog = useCallback((row: TerminalLogLine) => {
    setLines((prev) => {
      if (prev.some((p) => p.id === row.id)) return prev;
      return [...prev, row];
    });
  }, []);

  useEffect(() => {
    setLines([]);
    setStreamError(null);
  }, [tab]);

  useEffect(() => {
    if (!session?.access_token) {
      setConnection("idle");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    bufferRef.current = "";
    setStreamError(null);
    setConnection("connecting");

    const url = buildStreamUrl(projectId, tab);
    const token = session.access_token;

    void (async () => {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${token}`,
          },
          signal: ac.signal,
          cache: "no-store",
        });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setConnection("error");
          setStreamError(text || `Stream failed (${res.status})`);
          return;
        }

        setConnection("live");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (!ac.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          bufferRef.current += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseFrames(bufferRef.current);
          bufferRef.current = rest;
          for (const ev of events) {
            if (ev.event === "ready") continue;
            if (ev.event === "warning") {
              try {
                const j = JSON.parse(ev.data) as { message?: string };
                if (j.message) setStreamError(j.message);
              } catch {
                /* ignore */
              }
              continue;
            }
            if (ev.event === "error") {
              try {
                const j = JSON.parse(ev.data) as { message?: string };
                setStreamError(j.message ?? "Stream error");
              } catch {
                setStreamError(ev.data);
              }
              continue;
            }
            if (ev.event === "log") {
              try {
                const row = JSON.parse(ev.data) as Record<string, unknown>;
                appendLog({
                  id: String(
                    row.id ??
                      ev.id ??
                      `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                  ),
                  created_at:
                    row.created_at != null ? String(row.created_at) : null,
                  severity: row.severity != null ? String(row.severity) : null,
                  event_type:
                    row.event_type != null ? String(row.event_type) : null,
                  message: row.message != null ? String(row.message) : null,
                  source: row.source != null ? String(row.source) : null,
                });
              } catch {
                /* ignore malformed */
              }
            }
          }
        }
        if (!ac.signal.aborted) setConnection("idle");
      } catch (e) {
        if (ac.signal.aborted) return;
        setConnection("error");
        setStreamError(e instanceof Error ? e.message : "Connection lost.");
      }
    })();

    return () => {
      ac.abort();
    };
  }, [session, projectId, tab, router, appendLog]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredLines.length]);

  const handleClear = () => {
    setLines([]);
    setStreamError(null);
  };

  const handleCopy = async () => {
    const text = filteredLines
      .map(
        (l) =>
          `[${l.created_at ?? "?"}] ${l.severity ?? "—"} ${l.event_type ?? "—"} ${l.message ?? ""}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text || "(no visible logs)");
      setCopyFlash(true);
      window.setTimeout(() => setCopyFlash(false), 1500);
    } catch {
      setStreamError("Could not copy to clipboard.");
    }
  };

  const onPromptKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  const onPromptSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  if (session === undefined) {
    return (
      <div className="relative min-h-screen bg-black text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(111,232,154,0.12),transparent_55%)]" />
        <div className="relative z-10 flex min-h-screen items-center justify-center text-sm text-white/50">
          Loading…
        </div>
      </div>
    );
  }

  if (!session) return null;

  const connectionPill =
    connection === "live"
      ? "border-basil-400/50 bg-basil-500/15 text-basil-200"
      : connection === "connecting"
        ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
        : connection === "error"
          ? "border-red-400/40 bg-red-500/10 text-red-100"
          : "border-white/15 bg-white/[0.04] text-white/60";

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(111,232,154,0.14),transparent_50%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(111,232,154,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(111,232,154,0.35)_1px,transparent_1px)] [background-size:40px_40px]" />

      <div className="relative z-10 flex min-h-screen">
        <DashboardSidebar activeKey="projects" />
        <div className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
            <div className="mx-auto max-w-6xl px-4 py-5 sm:px-8">
              <PageHeader
                eyebrow="Project console"
                title="Read-only terminal"
                subtitle={
                  projectName
                    ? `${projectName} · live infrastructure logs`
                    : "Live infrastructure logs"
                }
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Projects", href: "/dashboard/projects" },
                  {
                    label: projectSlug ?? projectId.slice(0, 8),
                    href: `/dashboard/projects/${projectId}`,
                  },
                  { label: "Terminal" },
                ]}
                actions={
                  <Link
                    href={`/dashboard/projects/${projectId}`}
                    className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                  >
                    ← Project
                  </Link>
                }
              />
            </div>
          </header>

          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-8">
            <div
              role="status"
              className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-100/95 backdrop-blur-sm"
            >
              <span className="font-medium text-amber-50">
                Read-only terminal.
              </span>{" "}
              Command execution is not enabled yet. This view streams{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-basil-200/90">
                infrastructure_logs
              </code>{" "}
              for this project only.
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(["deployment", "runtime", "system"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] transition-colors ${
                    tab === t
                      ? "border-basil-400/55 bg-basil-500/15 text-basil-100 shadow-[0_0_24px_rgba(111,232,154,0.12)]"
                      : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white/80"
                  }`}
                >
                  {tabLabel(t)}
                </button>
              ))}
              <span
                className={`ml-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${connectionPill}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connection === "live"
                      ? "animate-pulse bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.9)]"
                      : connection === "connecting"
                        ? "bg-amber-300"
                        : connection === "error"
                          ? "bg-red-300"
                          : "bg-white/30"
                  }`}
                />
                {connection === "live"
                  ? "SSE live"
                  : connection === "connecting"
                    ? "Connecting"
                    : connection === "error"
                      ? "Disconnected"
                      : "Idle"}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter message / event / time…"
                className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-basil-100/90 outline-none ring-0 placeholder:text-white/30 focus:border-basil-400/40"
              />
              <input
                type="text"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                placeholder="severity (e.g. info)"
                className="w-40 rounded-xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-basil-100/90 outline-none placeholder:text-white/30 focus:border-basil-400/40"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-xl border border-basil-400/35 bg-basil-500/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-basil-100 transition-colors hover:bg-basil-500/20"
              >
                {copyFlash ? "Copied" : "Copy visible"}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-xl border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white/75 transition-colors hover:border-white/25 hover:text-white"
              >
                Clear view
              </button>
            </div>

            {streamError ? (
              <div
                role="alert"
                className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-100"
              >
                {streamError}
              </div>
            ) : null}

            <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-basil-500/20 bg-gradient-to-b from-black via-[#050805] to-black shadow-[0_0_60px_rgba(111,232,154,0.06),inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-black/60 px-4 py-2.5">
                <TerminalIcon className="h-4 w-4 text-basil-400/90" />
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-basil-200/70">
                  gtlnav · {tabLabel(tab)}
                </span>
              </div>

              <div
                ref={scrollRef}
                className="scrollbar-thin flex-1 overflow-y-auto px-3 py-3 font-mono text-[11px] leading-relaxed sm:text-xs"
              >
                {filteredLines.length === 0 ? (
                  <p className="px-2 py-8 text-center text-white/35">
                    {connection === "connecting"
                      ? "Connecting to log stream…"
                      : "No lines match filters yet. Logs appear as the control plane emits them."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {filteredLines.map((line) => (
                      <li
                        key={line.id}
                        className="break-words rounded-lg border border-transparent px-2 py-1 hover:border-white/[0.06] hover:bg-white/[0.02]"
                      >
                        <span className="text-white/35">
                          [{line.created_at ?? "—"}]
                        </span>{" "}
                        <span
                          className={
                            (line.severity ?? "").toLowerCase() === "error" ||
                            (line.severity ?? "").toLowerCase() === "critical"
                              ? "text-red-300/90"
                              : (line.severity ?? "").toLowerCase() === "warning" ||
                                  (line.severity ?? "").toLowerCase() === "warn"
                                ? "text-amber-200/90"
                                : "text-basil-300/85"
                          }
                        >
                          {line.severity ?? "—"}
                        </span>{" "}
                        <span className="text-cyan-200/75">
                          {line.event_type ?? "—"}
                        </span>{" "}
                        <span className="text-white/80">{line.message ?? ""}</span>
                        {line.source ? (
                          <span className="text-white/30">
                            {" "}
                            · <span className="italic">{line.source}</span>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <form
                onSubmit={onPromptSubmit}
                className="border-t border-white/[0.06] bg-black/70 px-3 py-2.5"
              >
                <div className="flex items-center gap-2 font-mono text-xs sm:text-sm">
                  <span className="shrink-0 text-basil-400/90">gtlnav@project</span>
                  <span className="text-basil-500/80">:</span>
                  <span className="shrink-0 text-white/45">~</span>
                  <span className="text-basil-300/70">$</span>
                  <input
                    readOnly
                    aria-readonly
                    aria-label="Command prompt (read-only)"
                    placeholder="commands disabled — streaming logs only"
                    className="min-w-0 flex-1 cursor-not-allowed border-0 bg-transparent py-1 text-basil-100/85 outline-none ring-0 placeholder:text-white/25"
                    onKeyDown={onPromptKeyDown}
                  />
                </div>
              </form>
            </div>

            <p className="text-center text-[10px] uppercase tracking-[0.2em] text-white/30">
              GTLNAV logs streaming API · poll every 2s · no WebSocket
            </p>
          </main>
        </div>
      </div>
    </div>
  );
}
