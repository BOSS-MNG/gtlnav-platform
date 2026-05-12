"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { ConfirmModal } from "@/src/components/ui/confirm-modal";
import { startRealDeployment } from "@/src/lib/deploy-client";
import { absoluteTime, relativeTime } from "@/src/lib/dashboard-format";

type DeployHookRow = {
  id: string;
  user_id?: string | null;
  project_id?: string | null;
  name?: string | null;
  branch?: string | null;
  secret_prefix?: string | null;
  secret_hash?: string | null;
  status?: string | null;
  created_at?: string | null;
  last_triggered_at?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type ProjectRow = {
  id: string;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  status?: string | null;
};

type LoadResult = {
  hooks: DeployHookRow[];
  projects: ProjectRow[];
  tableAvailable: boolean;
  errors: string[];
};

const BRANCHES = ["main", "staging", "preview", "production"] as const;
type BranchScope = (typeof BRANCHES)[number];

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

const WEBHOOK_BASE =
  "https://gtlnav.godtechlabs.com/api/hooks/deploy";

function webhookUrl(hookId: string) {
  return `${WEBHOOK_BASE}/${hookId}`;
}

function isMissingTableError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("not found")
  );
}

function generateHookSecret() {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const len = 28;
  const cryptoObj =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  const bytes = new Uint8Array(len);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let suffix = "";
  for (let i = 0; i < len; i++) {
    suffix += alphabet[bytes[i] % alphabet.length];
  }
  const fullKey = `gtlnav_hook_${suffix}`;
  const prefix = fullKey.slice(0, "gtlnav_hook_".length + 6); // gtlnav_hook_xxxxxx
  return { fullKey, prefix };
}

async function fakeHash(value: string): Promise<string> {
  if (
    typeof globalThis.crypto !== "undefined" &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === "function"
  ) {
    try {
      const enc = new TextEncoder();
      const buf = await globalThis.crypto.subtle.digest(
        "SHA-256",
        enc.encode(value),
      );
      const arr = Array.from(new Uint8Array(buf));
      return (
        "sha256:" +
        arr.map((b) => b.toString(16).padStart(2, "0")).join("")
      );
    } catch {
      // fall through
    }
  }
  return `sha256-fallback:${value.length}:${Date.now().toString(36)}`;
}

async function insertInfraLog(
  userId: string,
  projectId: string | null,
  eventType: string,
  message: string,
  severity: string,
  metadata?: Record<string, unknown>,
) {
  const full = {
    user_id: userId,
    project_id: projectId,
    event_type: eventType,
    level: severity,
    severity,
    message,
    source: "webhooks_console",
    metadata: metadata ?? {},
  };
  const { error } = await supabase.from("infrastructure_logs").insert(full);
  if (!error) return;
  await supabase.from("infrastructure_logs").insert({
    user_id: userId,
    project_id: projectId,
    event_type: eventType,
    severity,
    message,
  });
}

async function loadHooksData(userId: string): Promise<LoadResult> {
  const errors: string[] = [];

  const hooksRes = await supabase
    .from("deploy_hooks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  let tableAvailable = true;
  let hooks: DeployHookRow[] = [];
  if (hooksRes.error) {
    if (isMissingTableError(hooksRes.error.message)) {
      tableAvailable = false;
    } else {
      errors.push(`deploy_hooks: ${hooksRes.error.message}`);
    }
  } else {
    hooks = (hooksRes.data ?? []) as DeployHookRow[];
  }

  const projectsRes = await supabase
    .from("projects")
    .select("id, name, slug, framework, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (projectsRes.error) {
    errors.push(`projects: ${projectsRes.error.message}`);
  }

  return {
    hooks,
    projects: (projectsRes.data ?? []) as ProjectRow[],
    tableAvailable,
    errors,
  };
}

export function WebhooksClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tableAvailable, setTableAvailable] = useState(true);
  const [hooks, setHooks] = useState<DeployHookRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [revealHook, setRevealHook] = useState<{
    hookId: string;
    name: string;
    project: string;
    branch: string;
    secret: string;
    url: string;
  } | null>(null);
  const [revealCopied, setRevealCopied] = useState<string | null>(null);

  const [busyHookId, setBusyHookId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DeployHookRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const flashToast = useCallback(
    (tone: "success" | "error" | "info", text: string) => {
      setToast({ tone, text });
      window.setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  const refresh = useCallback(
    async (userId: string, mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const result = await loadHooksData(userId);
        setHooks(result.hooks);
        setProjects(result.projects);
        setTableAvailable(result.tableAvailable);
        setLoadErrors(result.errors);
      } catch (e) {
        setLoadErrors([
          e instanceof Error ? e.message : "Failed to load deploy hooks.",
        ]);
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      const cur = data.session ?? null;
      setSession(cur);
      if (!cur) {
        router.replace("/login");
        return;
      }
      await refresh(cur.user.id, "initial");
    }
    void init();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        if (!active) return;
        setSession(next);
        if (!next) {
          router.replace("/login");
          return;
        }
        void refresh(next.user.id, "refresh");
      },
    );
    return () => {
      active = false;
      listener?.subscription.unsubscribe();
    };
  }, [refresh, router]);

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectRow>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  async function handleCreate(input: {
    projectId: string;
    name: string;
    branch: BranchScope;
  }) {
    const uid = session?.user?.id;
    if (!uid) return;
    const project = projectsById.get(input.projectId);
    if (!project) {
      flashToast("error", "Pick a valid project.");
      return;
    }
    const name = input.name.trim();
    if (!name) {
      flashToast("error", "Name your hook so it's easy to revoke later.");
      return;
    }
    const { fullKey, prefix } = generateHookSecret();
    const hash = await fakeHash(fullKey);
    const now = new Date().toISOString();

    const fullPayload = {
      user_id: uid,
      project_id: project.id,
      name,
      branch: input.branch,
      secret_prefix: prefix,
      secret_hash: hash,
      status: "active",
      created_at: now,
      last_triggered_at: null,
      metadata: { simulated: true },
    };

    let { data, error } = await supabase
      .from("deploy_hooks")
      .insert(fullPayload)
      .select("id")
      .single();
    if (error) {
      const fallback = await supabase
        .from("deploy_hooks")
        .insert({
          user_id: uid,
          project_id: project.id,
          name,
          branch: input.branch,
          secret_prefix: prefix,
          secret_hash: hash,
          status: "active",
        })
        .select("id")
        .single();
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data) {
      if (error && isMissingTableError(error.message)) {
        setTableAvailable(false);
        flashToast(
          "error",
          "deploy_hooks table is missing. See setup SQL below.",
        );
        return;
      }
      flashToast("error", error?.message ?? "Failed to create deploy hook.");
      return;
    }

    const hookId = data.id as string;

    await insertInfraLog(
      uid,
      project.id,
      "deploy_hook_created",
      `Deploy hook ${name} created for ${project.name ?? project.slug ?? project.id}.`,
      "success",
      {
        hook_id: hookId,
        branch: input.branch,
        secret_prefix: prefix,
      },
    );

    setCreateOpen(false);
    setRevealHook({
      hookId,
      name,
      project: project.name ?? project.slug ?? project.id,
      branch: input.branch,
      secret: fullKey,
      url: webhookUrl(hookId),
    });
    flashToast("success", "Deploy hook created. Copy the secret now.");
    void refresh(uid, "refresh");
  }

  async function handleTest(hook: DeployHookRow) {
    const uid = session?.user?.id;
    if (!uid) return;
    const project = hook.project_id
      ? projectsById.get(hook.project_id)
      : undefined;
    if (!project) {
      flashToast("error", "Project for this hook is no longer available.");
      return;
    }
    if ((hook.status ?? "").toLowerCase() === "revoked") {
      flashToast("error", "This hook is revoked.");
      return;
    }

    setBusyHookId(hook.id);
    try {
      const branch = hook.branch ?? "main";

      await insertInfraLog(
        uid,
        project.id,
        "webhook_received",
        `Webhook received for project ${project.name ?? project.slug ?? project.id} on branch ${branch}.`,
        "info",
        {
          hook_id: hook.id,
          branch,
          source: "deploy_hook",
        },
      );

      const now = new Date().toISOString();
      const { error: triggerErr } = await supabase
        .from("deploy_hooks")
        .update({ last_triggered_at: now })
        .eq("id", hook.id)
        .eq("user_id", uid);
      if (triggerErr && !isMissingTableError(triggerErr.message)) {
        flashToast("error", triggerErr.message);
        return;
      }

      const start = await startRealDeployment({
        projectId: project.id,
        branch,
      });
      if (!start.ok) {
        flashToast("error", start.message);
        return;
      }
      if (start.warning) flashToast("info", start.warning);
      flashToast(
        "info",
        `Webhook deployment queued for ${project.name ?? project.slug}. A worker will pick it up.`,
      );
      await refresh(uid, "refresh");
    } finally {
      setBusyHookId(null);
    }
  }

  async function handleRevoke() {
    const uid = session?.user?.id;
    if (!uid || !revokeTarget) return;
    setRevokeError(null);
    setRevokeBusy(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("deploy_hooks")
        .update({ status: "revoked", revoked_at: now })
        .eq("id", revokeTarget.id)
        .eq("user_id", uid);
      if (error) {
        // some tables won't have revoked_at column → retry without it
        const fallback = await supabase
          .from("deploy_hooks")
          .update({ status: "revoked" })
          .eq("id", revokeTarget.id)
          .eq("user_id", uid);
        if (fallback.error) {
          setRevokeError(fallback.error.message);
          return;
        }
      }
      await insertInfraLog(
        uid,
        revokeTarget.project_id ?? null,
        "deploy_hook_revoked",
        `Deploy hook ${revokeTarget.name ?? revokeTarget.id} revoked.`,
        "warning",
        {
          hook_id: revokeTarget.id,
          branch: revokeTarget.branch ?? null,
        },
      );
      flashToast("info", "Deploy hook revoked.");
      setRevokeTarget(null);
      void refresh(uid, "refresh");
    } finally {
      setRevokeBusy(false);
    }
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(
        () => setCopiedKey((c) => (c === key ? null : c)),
        1500,
      );
    } catch {
      flashToast("error", "Could not copy to clipboard.");
    }
  }

  async function copyReveal(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setRevealCopied(key);
      window.setTimeout(
        () => setRevealCopied((c) => (c === key ? null : c)),
        1500,
      );
    } catch {
      flashToast("error", "Could not copy to clipboard.");
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (session === undefined) {
    return <FullPageMessage label="Verifying session…" />;
  }
  if (!session) {
    return <FullPageMessage label="Redirecting to sign in…" />;
  }

  const user = session.user;
  const activeCount = hooks.filter(
    (h) => (h.status ?? "active").toLowerCase() === "active",
  ).length;
  const revokedCount = hooks.length - activeCount;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[60] max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
            toast.tone === "success"
              ? "border-basil-400/40 bg-basil-500/15 text-basil-50"
              : toast.tone === "error"
                ? "border-red-400/40 bg-red-500/15 text-red-100"
                : "border-white/15 bg-white/[0.08] text-white/90"
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="webhooks" userEmail={user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // webhooks
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Deploy hooks
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                Trigger GTLNAV deployments from any provider that can hit a URL
                — GitHub, GitLab, Bitbucket, CI runners, cron jobs, or your own
                scripts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refresh(user.id, "refresh")}
                disabled={refreshing}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white disabled:opacity-50"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                disabled={!tableAvailable || projects.length === 0}
                className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-xs font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
                title={
                  projects.length === 0
                    ? "Create a project first"
                    : "Create a deploy hook"
                }
              >
                ＋ Create deploy hook
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          {loadErrors.length > 0 ? (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
            >
              <p className="font-medium">Some data couldn&apos;t be loaded:</p>
              <ul className="mt-1 list-disc pl-5 text-amber-200/85">
                {loadErrors.map((err, i) => (
                  <li key={i} className="font-mono text-xs">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <section className="mt-8 grid gap-3 sm:grid-cols-3">
            <SummaryTile label="Total hooks" value={hooks.length} />
            <SummaryTile label="Active" value={activeCount} accent />
            <SummaryTile label="Revoked" value={revokedCount} />
          </section>

          {!tableAvailable ? (
            <MissingTablePanel />
          ) : (
            <section className="mt-8 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                    // deploy-hooks
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-white sm:text-lg">
                    All deploy hooks
                  </h2>
                </div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                  {loading
                    ? "Loading…"
                    : `${hooks.length} ${hooks.length === 1 ? "hook" : "hooks"}`}
                </p>
              </div>

              <div className="overflow-x-auto p-5 sm:p-6">
                {loading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]"
                      />
                    ))}
                  </div>
                ) : hooks.length === 0 ? (
                  <EmptyHooks
                    hasProjects={projects.length > 0}
                    onCreate={() => setCreateOpen(true)}
                  />
                ) : (
                  <table className="w-full min-w-[820px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-white/40">
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Project</th>
                        <th className="px-3 py-3">Branch</th>
                        <th className="px-3 py-3">Webhook URL</th>
                        <th className="px-3 py-3">Secret</th>
                        <th className="px-3 py-3">Last triggered</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hooks.map((h) => {
                        const project = h.project_id
                          ? projectsById.get(h.project_id)
                          : undefined;
                        const url = webhookUrl(h.id);
                        const status = (h.status ?? "active").toLowerCase();
                        const revoked = status === "revoked";
                        const urlKey = `url:${h.id}`;
                        const secretKey = `prefix:${h.id}`;
                        return (
                          <tr
                            key={h.id}
                            className={`border-b border-white/5 last:border-0 ${
                              revoked ? "opacity-60" : "hover:bg-white/[0.02]"
                            }`}
                          >
                            <td className="px-3 py-3 align-top">
                              <div className="flex flex-col gap-1">
                                <span className="text-sm text-white">
                                  {h.name ?? "Unnamed hook"}
                                </span>
                                {revoked ? (
                                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-red-200">
                                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                    Revoked
                                  </span>
                                ) : (
                                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-basil-400/40 bg-basil-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-basil-100">
                                    <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.95)]" />
                                    Active
                                  </span>
                                )}
                                <span
                                  className="text-[10px] uppercase tracking-[0.18em] text-white/35"
                                  title={absoluteTime(h.created_at)}
                                >
                                  Created {relativeTime(h.created_at)}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              {project ? (
                                <Link
                                  href={`/dashboard/projects/${project.id}`}
                                  className="text-sm text-basil-200 transition-colors hover:text-basil-100"
                                >
                                  {project.name ?? project.slug ?? project.id}
                                </Link>
                              ) : (
                                <span className="text-xs text-white/40">—</span>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
                                {(h.branch ?? "main").toLowerCase()}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="flex items-center gap-2">
                                <code className="block max-w-[260px] truncate rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-basil-200/90">
                                  {url}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => void copyText(urlKey, url)}
                                  className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55 hover:border-basil-400/40"
                                >
                                  {copiedKey === urlKey ? "Copied" : "Copy"}
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="flex items-center gap-2">
                                <code className="block rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-white/70">
                                  {h.secret_prefix ?? "—"}
                                </code>
                                <button
                                  type="button"
                                  disabled={!h.secret_prefix}
                                  onClick={() =>
                                    void copyText(secretKey, h.secret_prefix ?? "")
                                  }
                                  className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55 hover:border-basil-400/40 disabled:opacity-40"
                                >
                                  {copiedKey === secretKey ? "Copied" : "Copy"}
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top text-xs text-white/55">
                              {h.last_triggered_at ? (
                                <span title={absoluteTime(h.last_triggered_at)}>
                                  {relativeTime(h.last_triggered_at)}
                                </span>
                              ) : (
                                <span className="text-white/35">Never</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right align-top">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <button
                                  type="button"
                                  disabled={busyHookId === h.id || revoked}
                                  onClick={() => void handleTest(h)}
                                  className="rounded-full border border-basil-400/40 bg-basil-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-basil-100 transition-colors hover:bg-basil-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busyHookId === h.id ? "Triggering…" : "Test"}
                                </button>
                                {!revoked ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRevokeError(null);
                                      setRevokeTarget(h);
                                    }}
                                    className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-red-200 transition-colors hover:bg-red-500/20"
                                  >
                                    Revoke
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          )}

          <GithubGuide />
        </main>
      </div>

      <CreateHookModal
        open={createOpen}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => void handleCreate(input)}
      />

      <RevealHookModal
        data={revealHook}
        copiedKey={revealCopied}
        onCopy={(key, value) => void copyReveal(key, value)}
        onClose={() => {
          setRevealHook(null);
          setRevealCopied(null);
        }}
      />

      <ConfirmModal
        open={Boolean(revokeTarget)}
        title="Revoke this deploy hook?"
        description={`"${revokeTarget?.name ?? "Unnamed"}" will stop accepting webhooks immediately.`}
        confirmLabel="Revoke"
        destructive
        busy={revokeBusy}
        error={revokeError}
        onClose={() => {
          if (!revokeBusy) setRevokeTarget(null);
        }}
        onConfirm={() => void handleRevoke()}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
      <div
        className={`absolute inset-x-0 top-0 h-px ${
          accent
            ? "bg-gradient-to-r from-transparent via-basil-300/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-white/15 to-transparent"
        }`}
      />
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/45">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold tracking-tight ${
          accent ? "text-basil-200" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyHooks({
  hasProjects,
  onCreate,
}: {
  hasProjects: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
      <p className="text-base font-medium text-white">No deploy hooks yet</p>
      <p className="mt-1 text-sm text-white/55">
        {hasProjects
          ? "Create one to receive POST webhooks from GitHub, CI, or any other system."
          : "Create a project first, then add a deploy hook."}
      </p>
      {hasProjects ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
        >
          ＋ Create deploy hook
        </button>
      ) : (
        <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
        >
          Create a project →
        </Link>
      )}
    </div>
  );
}

function CreateHookModal({
  open,
  projects,
  onClose,
  onSubmit,
}: {
  open: boolean;
  projects: ProjectRow[];
  onClose: () => void;
  onSubmit: (input: {
    projectId: string;
    name: string;
    branch: BranchScope;
  }) => void;
}) {
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState<BranchScope>("main");

  useEffect(() => {
    if (!open) {
      setProjectId(projects[0]?.id ?? "");
      setName("");
      setBranch("main");
    } else {
      setProjectId((cur) =>
        cur && projects.some((p) => p.id === cur)
          ? cur
          : (projects[0]?.id ?? ""),
      );
    }
  }, [open, projects]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    onSubmit({ projectId, name: name.trim(), branch });
  }

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md">
        <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-80 blur-md" />
        <div className="relative max-h-[88vh] overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-7 shadow-[0_0_60px_-15px_rgba(111,232,154,0.5)] backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                // create-hook
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Create deploy hook
              </h2>
              <p className="mt-1 text-sm text-white/55">
                Generate a unique URL + secret for this project and branch.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-white/60 transition-colors hover:border-basil-400/40 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                Project
              </label>
              <select
                className={inputClass}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-black">
                    {p.name ?? p.slug ?? p.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                Hook name
              </label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="GitHub · production deploys"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                Branch
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BRANCHES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBranch(b)}
                    className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.18em] transition-all ${
                      branch === b
                        ? "border-basil-400/50 bg-basil-500/15 text-basil-100"
                        : "border-white/10 bg-white/[0.02] text-white/65 hover:border-basil-400/30 hover:text-white"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!projectId}
                className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:opacity-50"
              >
                Generate hook
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function RevealHookModal({
  data,
  copiedKey,
  onCopy,
  onClose,
}: {
  data: {
    hookId: string;
    name: string;
    project: string;
    branch: string;
    secret: string;
    url: string;
  } | null;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  onClose: () => void;
}) {
  if (!data) return null;
  const githubInstructions = [
    "Open your GitHub repository → Settings → Webhooks.",
    "Click Add webhook.",
    `Payload URL: ${data.url}`,
    "Content type: application/json",
    `Secret: paste the deploy hook secret above (gtlnav_hook_…).`,
    "Which events? Just the push event.",
    "Active: ✓ · Save webhook.",
  ];
  const githubBlock = githubInstructions.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl">
        <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/50 via-basil-500/10 to-transparent opacity-80 blur-md" />
        <div className="relative max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-7 shadow-[0_0_60px_-15px_rgba(111,232,154,0.6)] backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/70 to-transparent" />
          <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/90">
            // copy-now
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            Deploy hook ready: &ldquo;{data.name}&rdquo;
          </h2>
          <p className="mt-2 text-sm text-amber-200/85">
            The full secret is shown only this once. Copy it now and store it
            with your CI / GitHub webhook config.
          </p>

          <div className="mt-5 grid gap-3">
            <RevealRow
              label="Webhook URL"
              value={data.url}
              copied={copiedKey === "reveal:url"}
              onCopy={() => onCopy("reveal:url", data.url)}
              accent
            />
            <RevealRow
              label="Hook secret"
              value={data.secret}
              copied={copiedKey === "reveal:secret"}
              onCopy={() => onCopy("reveal:secret", data.secret)}
              accent
              danger
            />
            <RevealRow
              label="Project"
              value={data.project}
              copied={copiedKey === "reveal:project"}
              onCopy={() => onCopy("reveal:project", data.project)}
            />
            <RevealRow
              label="Branch"
              value={data.branch}
              copied={copiedKey === "reveal:branch"}
              onCopy={() => onCopy("reveal:branch", data.branch)}
            />
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/55 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-basil-300/80">
                GitHub webhook setup
              </p>
              <button
                type="button"
                onClick={() => onCopy("reveal:github", githubBlock)}
                className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/70 hover:border-basil-400/40"
              >
                {copiedKey === "reveal:github" ? "Copied" : "Copy steps"}
              </button>
            </div>
            <ol className="mt-3 space-y-1.5 text-xs text-white/70">
              {githubInstructions.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[1px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-basil-400/40 bg-basil-500/10 font-mono text-[9px] text-basil-200">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/80 transition-colors hover:border-white/20 hover:text-white"
            >
              I&apos;ve copied it · close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RevealRow({
  label,
  value,
  copied,
  onCopy,
  accent,
  danger,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-black/45 p-3 ${
        danger
          ? "border-red-400/30"
          : accent
            ? "border-basil-400/40"
            : "border-white/10"
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code className="block flex-1 break-all font-mono text-sm text-white">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className={`shrink-0 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
            copied
              ? "border border-basil-400/40 bg-basil-500/10 text-basil-100"
              : "border border-white/10 text-white/65 hover:border-basil-400/40"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function GithubGuide() {
  return (
    <section className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // github-setup
      </p>
      <h2 className="mt-2 text-lg font-semibold text-white">
        Wire it up in GitHub
      </h2>
      <p className="mt-1 max-w-xl text-sm text-white/55">
        Once you have a deploy hook, GitHub can trigger GTLNAV deploys on
        every push.
      </p>
      <ol className="mt-5 space-y-2 text-sm text-white/75">
        {[
          "Open your GitHub repository.",
          "Go to Settings → Webhooks.",
          "Click Add webhook.",
          "Payload URL: paste your GTLNAV deploy hook URL.",
          "Content type: application/json.",
          "Secret: paste your deploy hook secret (gtlnav_hook_…).",
          "Which events? Just the push event.",
          "Save the webhook.",
        ].map((step, idx) => (
          <li key={idx} className="flex gap-3">
            <span className="mt-[2px] inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-basil-400/40 bg-basil-500/10 font-mono text-[10px] text-basil-200">
              {idx + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs text-white/45">
        GitLab and Bitbucket use the same URL — point the webhook at the GTLNAV
        endpoint and select the push event.
      </p>
    </section>
  );
}

function MissingTablePanel() {
  return (
    <section className="relative mt-8 overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" />
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-amber-200/80">
        // setup-required
      </p>
      <h2 className="mt-2 text-lg font-semibold text-white">
        Deploy hooks table is missing
      </h2>
      <p className="mt-1 max-w-xl text-sm text-white/60">
        Run this SQL in Supabase to enable webhook-based deploys. We only
        store metadata, the secret prefix, and a hash of the secret — never
        the raw token.
      </p>
      <pre className="mt-5 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-[11px] text-basil-200/90">
{`create table public.deploy_hooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  branch text not null default 'main',
  secret_prefix text not null,
  secret_hash text not null,
  status text not null default 'active',
  last_triggered_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.deploy_hooks enable row level security;

create policy "deploy_hooks are user-owned"
  on public.deploy_hooks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);`}
      </pre>
    </section>
  );
}

function FullPageMessage({ label }: { label: string }) {
  return (
    <div className="relative grid min-h-screen place-items-center bg-black text-white">
      <BackgroundFX />
      <div className="relative z-10 flex items-center gap-3 text-sm text-white/60">
        <span className="grid h-9 w-9 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
          <span className="block h-2 w-2 animate-pulse rounded-full bg-basil-300 shadow-[0_0_12px_rgba(111,232,154,1)]" />
        </span>
        {label}
      </div>
    </div>
  );
}

function BackgroundFX() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -top-40 left-1/4 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-basil-500/15 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-600/10 blur-[100px]" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/40 to-transparent" />
    </div>
  );
}
