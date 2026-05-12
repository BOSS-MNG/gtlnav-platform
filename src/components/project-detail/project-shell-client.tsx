"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  KeyIcon,
  LockIcon,
  ServerIcon,
  ShieldIcon,
  TerminalIcon,
} from "@/src/components/ui/icons";

/**
 * RESERVED — locked shell UI placeholder.
 *
 * This component renders the future contract for an isolated, audited
 * shell session. It does NOT spawn a shell, run a command, or call any
 * privileged backend. The Start Shell Session button is disabled and the
 * read-only command prompt rejects every keypress at the form layer.
 */

type Requirement = {
  id: string;
  title: string;
  body: string;
  Icon: typeof LockIcon;
};

const REQUIREMENTS: Requirement[] = [
  {
    id: "container_isolation",
    title: "Container isolation",
    body: "Each session runs inside an ephemeral, per-project container with no host-network access and no shared filesystem.",
    Icon: ServerIcon,
  },
  {
    id: "non_root_user",
    title: "Non-root user",
    body: "The shell runs as a low-privilege user inside the container. Sudo, su, mount, and capabilities are dropped.",
    Icon: ShieldIcon,
  },
  {
    id: "command_allowlist",
    title: "Command allowlist",
    body: "Only safe commands are accepted (ls, cat, tail, grep, env, npm/pnpm scoped to project, …). Everything else is rejected at the API layer.",
    Icon: KeyIcon,
  },
  {
    id: "audit_logs",
    title: "Audit logs",
    body: "Every command, exit code, and stream byte count is written to infrastructure_logs in real time. Logs are immutable and retained per workspace policy.",
    Icon: TerminalIcon,
  },
  {
    id: "wall_clock_timeout",
    title: "Wall-clock + idle timeout",
    body: "Sessions are killed after 15 minutes of total runtime or 5 minutes of inactivity, whichever comes first. The container is destroyed on close.",
    Icon: LockIcon,
  },
  {
    id: "session_recording",
    title: "Session recording",
    body: "Full stdin/stdout is recorded and replayable for compliance review. Recordings are encrypted at rest and scoped to the workspace.",
    Icon: ShieldIcon,
  },
  {
    id: "workspace_permissions",
    title: "Workspace permissions",
    body: "Only members with shell:open permission on this workspace can start a session. Owners can revoke active sessions at any time.",
    Icon: KeyIcon,
  },
];

type EndpointSpec = {
  method: string;
  path: string;
  purpose: string;
  body?: string;
  response?: string;
};

const ENDPOINTS: EndpointSpec[] = [
  {
    method: "POST",
    path: "/api/terminal/session",
    purpose: "Open a new isolated shell session for a project.",
    body: '{ "project_id": "<uuid>", "shell": "bash", "ttl_seconds": 900 }',
    response:
      '{ "ok": true, "session_id": "<uuid>", "ws_url": "/api/terminal/<id>", "expires_at": "<iso>" }',
  },
  {
    method: "WS",
    path: "/api/terminal/[sessionId]",
    purpose: "Bidirectional pty stream (input ↔ output) over WebSocket.",
    body: 'frames: { "type": "input"|"resize"|"signal", "data": "..." }',
    response: 'frames: { "type": "stdout"|"stderr"|"exit", "data": "..." }',
  },
  {
    method: "POST",
    path: "/api/terminal/[sessionId]/command",
    purpose:
      "Submit a single allowlisted command (non-WebSocket clients, CLI, CI).",
    body: '{ "cmd": "ls -la /workspace", "timeout_ms": 10000 }',
    response: '{ "ok": true, "exit_code": 0, "stdout": "...", "stderr": "" }',
  },
  {
    method: "DELETE",
    path: "/api/terminal/[sessionId]",
    purpose:
      "Close the session, kill the container, flush the audit recording.",
    response: '{ "ok": true, "closed_at": "<iso>", "recording_id": "<uuid>" }',
  },
];

export function ProjectShellClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);

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

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(111,232,154,0.12),transparent_55%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(111,232,154,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(111,232,154,0.35)_1px,transparent_1px)] [background-size:40px_40px]" />

      <div className="relative z-10 flex min-h-screen">
        <DashboardSidebar activeKey="projects" />
        <div className="flex min-h-screen flex-1 flex-col">
          <header className="border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
            <div className="mx-auto max-w-6xl px-4 py-5 sm:px-8">
              <PageHeader
                eyebrow="Project shell"
                title="Isolated shell — locked"
                subtitle={
                  projectName
                    ? `${projectName} · interactive shell sessions are not enabled`
                    : "Interactive shell sessions are not enabled"
                }
                breadcrumbs={[
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "Projects", href: "/dashboard/projects" },
                  {
                    label: projectSlug ?? projectId.slice(0, 8),
                    href: `/dashboard/projects/${projectId}`,
                  },
                  { label: "Shell" },
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

          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
            <div
              role="status"
              className="flex flex-col gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-100/95 backdrop-blur-sm sm:flex-row sm:items-center sm:gap-4"
            >
              <span className="inline-flex items-center gap-2 font-medium text-amber-50">
                <LockIcon className="h-4 w-4" /> Shell locked
              </span>
              <span className="text-amber-100/85">
                This view is a UI + API placeholder. The control plane does not
                spawn shells, exec into containers, or run commands. Every
                terminal API endpoint currently returns{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-amber-200/95">
                  501 Not Implemented
                </code>
                .
              </span>
            </div>

            {/* Locked terminal preview */}
            <section className="relative overflow-hidden rounded-2xl border border-basil-500/20 bg-gradient-to-b from-black via-[#050805] to-black shadow-[0_0_60px_rgba(111,232,154,0.06),inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-2 border-b border-white/[0.06] bg-black/60 px-4 py-2.5">
                <TerminalIcon className="h-4 w-4 text-basil-400/90" />
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-basil-200/70">
                  gtlnav · interactive shell
                </span>
                <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                  Inactive
                </span>
              </div>

              <div className="relative px-4 py-6 font-mono text-xs leading-relaxed text-white/70 sm:text-sm">
                <pre className="whitespace-pre-wrap break-words text-basil-200/70">
{`# GTLNAV isolated shell — placeholder
# session_id : —
# project_id : ${projectSlug ?? projectId}
# expires_at : —
# allowlist  : ls, cat, tail, head, grep, env, pwd, whoami,
#              node --version, npm --version, pnpm --version
#
# Shell sessions are not enabled in this build. This panel
# is a preview of the future contract. No process is spawned.`}
                </pre>

                <form
                  onSubmit={(e) => e.preventDefault()}
                  className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/50 px-3 py-2"
                  aria-disabled
                >
                  <span className="shrink-0 text-basil-400/80">
                    gtlnav@project
                  </span>
                  <span className="text-basil-500/80">:</span>
                  <span className="shrink-0 text-white/45">~</span>
                  <span className="text-basil-300/70">$</span>
                  <input
                    readOnly
                    disabled
                    aria-readonly
                    aria-label="Command prompt (locked)"
                    placeholder="shell sessions disabled — start a session above (locked)"
                    className="min-w-0 flex-1 cursor-not-allowed border-0 bg-transparent py-1 text-basil-100/60 outline-none ring-0 placeholder:text-white/25"
                    onKeyDown={(e) => e.preventDefault()}
                  />
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-white/45">
                    <LockIcon className="h-3 w-3" /> locked
                  </span>
                </form>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled
                    aria-disabled
                    title="Shell sessions are not enabled in this build."
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 text-sm font-medium text-white/45 opacity-70"
                  >
                    <LockIcon className="h-4 w-4" />
                    Start Shell Session
                  </button>
                  <span className="text-xs text-white/40">
                    Disabled until container isolation, allowlist, and audit
                    pipeline are wired.
                  </span>
                </div>
              </div>

              {/* Diagonal "LOCKED" watermark */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <span className="rotate-[-12deg] font-mono text-[64px] font-bold uppercase tracking-[0.3em] text-white/[0.04] sm:text-[96px]">
                  Locked
                </span>
              </div>
            </section>

            {/* Requirements */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                Required before shell can be enabled
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-white/55">
                These controls must be in place before the control plane will
                accept a real shell session. This is the security envelope for
                interactive workspace access.
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {REQUIREMENTS.map((req) => {
                  const Icon = req.Icon;
                  return (
                    <li
                      key={req.id}
                      className="flex gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 backdrop-blur-sm"
                    >
                      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-basil-400/25 bg-basil-500/[0.08] text-basil-200">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white">
                          {req.title}
                        </h3>
                        <p className="mt-1 text-sm text-white/60">{req.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Future API design */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                Future API surface
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-white/55">
                Reserved endpoints. Calls to{" "}
                <code className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-xs text-basil-200/85">
                  /api/terminal/session
                </code>{" "}
                and{" "}
                <code className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-xs text-basil-200/85">
                  /api/terminal/[sessionId]
                </code>{" "}
                currently return{" "}
                <code className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-xs text-basil-200/85">
                  501 Not Implemented
                </code>{" "}
                with a structured payload describing this contract.
              </p>
              <ul className="mt-4 space-y-3">
                {ENDPOINTS.map((ep) => (
                  <li
                    key={`${ep.method}-${ep.path}`}
                    className="rounded-2xl border border-white/[0.08] bg-black/40 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${
                          ep.method === "WS"
                            ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
                            : ep.method === "DELETE"
                              ? "border-red-400/40 bg-red-500/10 text-red-200"
                              : "border-basil-400/40 bg-basil-500/10 text-basil-200"
                        }`}
                      >
                        {ep.method}
                      </span>
                      <code className="font-mono text-sm text-white/90">
                        {ep.path}
                      </code>
                    </div>
                    <p className="mt-2 text-sm text-white/60">{ep.purpose}</p>
                    {ep.body ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-basil-200/85">
                        <span className="text-white/35">request  </span>
                        {ep.body}
                      </pre>
                    ) : null}
                    {ep.response ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-cyan-200/85">
                        <span className="text-white/35">response </span>
                        {ep.response}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-center text-[10px] uppercase tracking-[0.2em] text-white/30">
              GTLNAV terminal shell · architecture placeholder · no commands
              executed
            </p>
          </main>
        </div>
      </div>
    </div>
  );
}
