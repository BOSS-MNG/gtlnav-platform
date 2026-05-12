"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { ConfirmModal } from "@/src/components/ui/confirm-modal";
import {
  PROVIDER_OPTIONS,
  normalizeProvider,
  providerLabel,
} from "@/src/lib/project-providers";

const FRAMEWORKS = [
  "Next.js",
  "Astro",
  "Remix",
  "SvelteKit",
  "Nuxt",
  "Vite",
  "Static",
  "Custom",
] as const;

const ENV_OPTIONS = ["production", "preview", "development"] as const;
type EnvScope = (typeof ENV_OPTIONS)[number];

type TabKey = "general" | "env" | "deployment" | "danger";

type ProjectRow = {
  id: string;
  user_id?: string | null;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  provider?: string | null;
  status?: string | null;
  live_url?: string | null;
  repo_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type EnvVarRow = {
  id: string;
  user_id?: string | null;
  project_id?: string | null;
  key?: string | null;
  value?: string | null;
  environment?: string | null;
  is_secret?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type SettingsLoad = {
  project: ProjectRow | null;
  envVars: EnvVarRow[];
  envTableAvailable: boolean;
  errors: string[];
  notFound: boolean;
};

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeEnvScope(raw: string | null | undefined): EnvScope {
  const s = (raw ?? "production").toLowerCase();
  if (s === "preview" || s === "development") return s;
  return "production";
}

async function insertInfraLog(
  userId: string,
  projectId: string,
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
    source: "project_settings",
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

async function loadSettingsData(
  userId: string,
  projectId: string,
): Promise<SettingsLoad> {
  const errors: string[] = [];

  const projectRes = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (projectRes.error) {
    errors.push(`projects: ${projectRes.error.message}`);
  }

  if (!projectRes.data) {
    return {
      project: null,
      envVars: [],
      envTableAvailable: false,
      errors,
      notFound: !projectRes.error,
    };
  }

  let envVars: EnvVarRow[] = [];
  let envTableAvailable = false;
  const envRes = await supabase
    .from("project_environment_variables")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (envRes.error) {
    const msg = envRes.error.message.toLowerCase();
    if (
      msg.includes("relation") ||
      msg.includes("does not exist") ||
      msg.includes("schema cache")
    ) {
      envTableAvailable = false;
      errors.push(
        "Environment variables table not found. Create public.project_environment_variables in Supabase to enable this section.",
      );
    } else {
      errors.push(`project_environment_variables: ${envRes.error.message}`);
    }
  } else {
    envTableAvailable = true;
    envVars = (envRes.data ?? []) as EnvVarRow[];
  }

  return {
    project: projectRes.data as ProjectRow,
    envVars,
    envTableAvailable,
    errors,
    notFound: false,
  };
}

export function ProjectSettingsClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<TabKey>("general");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [envVars, setEnvVars] = useState<EnvVarRow[]>([]);
  const [envTableAvailable, setEnvTableAvailable] = useState(false);

  const [toast, setToast] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [generalBusy, setGeneralBusy] = useState(false);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [formRepo, setFormRepo] = useState("");
  const [formLive, setFormLive] = useState("");
  const [formFramework, setFormFramework] = useState<string>(FRAMEWORKS[0]);
  const [formProviderLabel, setFormProviderLabel] = useState<string>(
    PROVIDER_OPTIONS[0].label,
  );

  const [dangerBusy, setDangerBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const computedSlug = useMemo(
    () => (slugTouched ? formSlug : slugify(formName)),
    [formName, formSlug, slugTouched],
  );

  const flashToast = useCallback(
    (tone: "success" | "error" | "info", text: string) => {
      setToast({ tone, text });
      window.setTimeout(() => setToast(null), 3200);
    },
    [],
  );

  const refresh = useCallback(
    async (userId: string, mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const result = await loadSettingsData(userId, projectId);
        setLoadErrors(result.errors);
        setNotFound(result.notFound);
        setProject(result.project);
        setEnvVars(result.envVars);
        setEnvTableAvailable(result.envTableAvailable);
        if (result.project) {
          const p = result.project;
          setFormName(p.name ?? "");
          setFormSlug(p.slug ?? "");
          setSlugTouched(!!p.slug);
          setFormRepo(p.repo_url ?? "");
          setFormLive(p.live_url ?? "");
          setFormFramework(
            p.framework && FRAMEWORKS.includes(p.framework as (typeof FRAMEWORKS)[number])
              ? (p.framework as (typeof FRAMEWORKS)[number])
              : p.framework ?? FRAMEWORKS[0],
          );
          const lbl = providerLabel(p.provider ?? "");
          setFormProviderLabel(
            lbl ||
              PROVIDER_OPTIONS.find((o) => o.value === (p.provider ?? ""))?.label ||
              PROVIDER_OPTIONS[0].label,
          );
        }
      } catch (e) {
        setLoadErrors([
          e instanceof Error ? e.message : "Failed to load project settings.",
        ]);
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [projectId],
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

  async function handleSaveGeneral(e: FormEvent) {
    e.preventDefault();
    const uid = session?.user?.id;
    if (!uid || !project) return;
    const name = formName.trim();
    const slug = (slugTouched ? formSlug.trim() : slugify(name)).trim();
    if (!name) {
      flashToast("error", "Project name is required.");
      return;
    }
    if (!slug) {
      flashToast("error", "Enter a valid slug.");
      return;
    }
    setGeneralBusy(true);
    try {
      const normalized = normalizeProvider(formProviderLabel);
      const { error } = await supabase
        .from("projects")
        .update({
          name,
          slug,
          repo_url: formRepo.trim() || null,
          live_url: formLive.trim() || null,
          framework: formFramework,
          provider: normalized || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id)
        .eq("user_id", uid);

      if (error) {
        flashToast("error", error.message);
        return;
      }
      await insertInfraLog(
        uid,
        project.id,
        "project_settings_updated",
        `Project settings updated for ${name}`,
        "info",
      );
      flashToast("success", "Project saved.");
      await refresh(uid, "refresh");
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Save failed.",
      );
    } finally {
      setGeneralBusy(false);
    }
  }

  async function handlePause() {
    const uid = session?.user?.id;
    if (!uid || !project) return;
    setDangerBusy(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          status: "paused",
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id)
        .eq("user_id", uid);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      await insertInfraLog(
        uid,
        project.id,
        "project_paused",
        `Project paused: ${project.name ?? project.slug}`,
        "warning",
      );
      flashToast("info", "Project paused.");
      await refresh(uid, "refresh");
    } finally {
      setDangerBusy(false);
    }
  }

  async function handleArchive() {
    const uid = session?.user?.id;
    if (!uid || !project) return;
    setDangerBusy(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          status: "archived",
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id)
        .eq("user_id", uid);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      await insertInfraLog(
        uid,
        project.id,
        "project_archived",
        `Project archived: ${project.name ?? project.slug}`,
        "warning",
      );
      flashToast("info", "Project archived.");
      await refresh(uid, "refresh");
    } finally {
      setDangerBusy(false);
    }
  }

  async function handleConfirmDelete() {
    const uid = session?.user?.id;
    if (!uid || !project) return;
    setDeleteError(null);
    setDangerBusy(true);
    try {
      const pid = project.id;

      await supabase
        .from("infrastructure_logs")
        .delete()
        .eq("project_id", pid)
        .eq("user_id", uid);

      await supabase
        .from("deployments")
        .delete()
        .eq("project_id", pid)
        .eq("user_id", uid);

      await supabase
        .from("domains")
        .delete()
        .eq("project_id", pid)
        .eq("user_id", uid);

      const envDel = await supabase
        .from("project_environment_variables")
        .delete()
        .eq("project_id", pid)
        .eq("user_id", uid);
      if (envDel.error) {
        const m = envDel.error.message.toLowerCase();
        if (
          !m.includes("relation") &&
          !m.includes("does not exist") &&
          !m.includes("schema cache")
        ) {
          setDeleteError(envDel.error.message);
          return;
        }
      }

      const { error: projErr } = await supabase
        .from("projects")
        .delete()
        .eq("id", pid)
        .eq("user_id", uid);

      if (projErr) {
        setDeleteError(projErr.message);
        return;
      }

      flashToast("success", "Project deleted.");
      setDeleteOpen(false);
      router.replace("/dashboard");
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Delete failed.",
      );
    } finally {
      setDangerBusy(false);
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

  if (loading) {
    return <FullPageMessage label="Loading project settings…" />;
  }

  if (notFound || !project) {
    return <NotFoundShell projectId={projectId} />;
  }

  const user = session.user;
  const projectName = project.name ?? project.slug ?? "Project";
  const statusLower = (project.status ?? "active").toLowerCase();

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
        <DashboardSidebar activeKey="projects" userEmail={user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-white/40">
                <Link
                  href="/dashboard"
                  className="text-basil-300/80 transition-colors hover:text-basil-200"
                >
                  dashboard
                </Link>
                <span className="text-white/25">/</span>
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  className="truncate text-basil-300/80 transition-colors hover:text-basil-200"
                >
                  {project.slug ?? project.id}
                </Link>
                <span className="text-white/25">/</span>
                <span className="text-white/55">settings</span>
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {projectName}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                General configuration, encrypted environment variables, deployment
                defaults, and lifecycle controls for this GTLNAV project.
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
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                ← Overview
              </Link>
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
              <p className="font-medium">Notice</p>
              <ul className="mt-1 list-disc pl-5 text-amber-200/85">
                {loadErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start">
            <nav className="flex shrink-0 flex-wrap gap-2 lg:w-52 lg:flex-col">
              <TabButton
                active={tab === "general"}
                onClick={() => setTab("general")}
                label="General"
              />
              <TabButton
                active={tab === "env"}
                onClick={() => setTab("env")}
                label="Environment"
              />
              <TabButton
                active={tab === "deployment"}
                onClick={() => setTab("deployment")}
                label="Deployment"
              />
              <TabButton
                active={tab === "danger"}
                onClick={() => setTab("danger")}
                label="Danger zone"
                danger
              />
            </nav>

            <div className="min-w-0 flex-1 space-y-6">
              {tab === "general" ? (
                <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                    // general
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-white">
                    Project identity
                  </h2>
                  <p className="mt-1 text-sm text-white/50">
                    Name, slug, repository, live URL, framework, and hosting
                    provider.
                  </p>

                  <form onSubmit={handleSaveGeneral} className="mt-6 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                          Name
                        </label>
                        <input
                          className={inputClass}
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                          Slug
                        </label>
                        <input
                          className={`${inputClass} font-mono`}
                          value={slugTouched ? formSlug : computedSlug}
                          onChange={(e) => {
                            setSlugTouched(true);
                            setFormSlug(e.target.value);
                          }}
                        />
                        <p className="mt-1 text-[10px] text-white/35">
                          URL-safe identifier. Leave blank while typing name to
                          auto-generate.
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                        Repository URL
                      </label>
                      <input
                        className={`${inputClass} font-mono text-xs sm:text-sm`}
                        value={formRepo}
                        onChange={(e) => setFormRepo(e.target.value)}
                        placeholder="https://github.com/org/repo"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                        Live URL
                      </label>
                      <input
                        className={`${inputClass} font-mono text-xs sm:text-sm`}
                        value={formLive}
                        onChange={(e) => setFormLive(e.target.value)}
                        placeholder="app.example.com"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                          Framework
                        </label>
                        <select
                          className={inputClass}
                          value={formFramework}
                          onChange={(e) => setFormFramework(e.target.value)}
                        >
                          {FRAMEWORKS.map((f) => (
                            <option key={f} value={f} className="bg-black">
                              {f}
                            </option>
                          ))}
                          {!FRAMEWORKS.includes(
                            formFramework as (typeof FRAMEWORKS)[number],
                          ) && formFramework ? (
                            <option value={formFramework} className="bg-black">
                              {formFramework}
                            </option>
                          ) : null}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                          Provider
                        </label>
                        <select
                          className={inputClass}
                          value={formProviderLabel}
                          onChange={(e) => setFormProviderLabel(e.target.value)}
                        >
                          {PROVIDER_OPTIONS.map((p) => (
                            <option key={p.value} value={p.label} className="bg-black">
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={generalBusy}
                        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-6 py-2.5 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:opacity-50"
                      >
                        {generalBusy ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </form>
                </section>
              ) : null}

              {tab === "env" ? (
                <EnvVarsPanel
                  userId={user.id}
                  projectId={project.id}
                  rows={envVars}
                  tableAvailable={envTableAvailable}
                  onRefresh={() => void refresh(user.id, "refresh")}
                  flashToast={flashToast}
                />
              ) : null}

              {tab === "deployment" ? (
                <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                    // deployment
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-white">
                    Build & release
                  </h2>
                  <p className="mt-1 text-sm text-white/50">
                    Default branch and build context. Full pipeline controls live
                    in the{" "}
                    <Link
                      href="/dashboard/deployments"
                      className="text-basil-300 underline-offset-4 hover:underline"
                    >
                      Deployments
                    </Link>{" "}
                    console.
                  </p>
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/50 p-4 font-mono text-xs text-white/60">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <span className="text-basil-300/90">status</span>
                      <span className="text-white/85">{project.status ?? "active"}</span>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                          Default branch
                        </p>
                        <p className="mt-1 text-sm text-basil-200/90">main</p>
                      </div>
                      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                          Framework
                        </p>
                        <p className="mt-1 text-sm text-white/85">
                          {project.framework ?? "—"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 sm:col-span-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                          Provider
                        </p>
                        <p className="mt-1 text-sm text-white/85">
                          {providerLabel(project.provider)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-[11px] text-white/45">
                      Trigger builds from the project overview or deployments
                      center. Environment variables above are injected at build and
                      runtime per scope.
                    </p>
                  </div>

                  <div className="mt-6 rounded-2xl border border-cyan-400/25 bg-cyan-500/[0.05] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-cyan-200/85">
                          // deploy-hooks
                        </p>
                        <p className="mt-1 text-sm font-medium text-white">
                          Webhook-driven deploys
                        </p>
                        <p className="mt-1 max-w-md text-xs text-white/55">
                          Generate a unique webhook URL + secret to trigger
                          deployments from GitHub, GitLab, Bitbucket, or any CI
                          system that can POST.
                        </p>
                      </div>
                      <Link
                        href="/dashboard/webhooks"
                        className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20"
                      >
                        Manage deploy hooks →
                      </Link>
                    </div>
                  </div>
                </section>
              ) : null}

              {tab === "danger" ? (
                <section className="relative overflow-hidden rounded-3xl border border-red-400/25 bg-gradient-to-br from-red-500/[0.06] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/40 to-transparent" />
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
                    // danger-zone
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-white">
                    Irreversible actions
                  </h2>
                  <p className="mt-1 text-sm text-white/55">
                    Pause stops new deploy traffic. Archive marks the project
                    inactive. Delete removes all related data for this project.
                  </p>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      disabled={
                        dangerBusy || statusLower.includes("paused")
                      }
                      onClick={() => void handlePause()}
                      className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm text-white/85 transition-colors hover:border-amber-400/40 hover:text-amber-100 disabled:opacity-40"
                    >
                      Pause project
                    </button>
                    <button
                      type="button"
                      disabled={
                        dangerBusy || statusLower.includes("archived")
                      }
                      onClick={() => void handleArchive()}
                      className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm text-white/85 transition-colors hover:border-amber-400/40 hover:text-amber-100 disabled:opacity-40"
                    >
                      Archive project
                    </button>
                    <button
                      type="button"
                      disabled={dangerBusy}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteOpen(true);
                      }}
                      className="rounded-full border border-red-400/40 bg-red-500/10 px-5 py-2.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                    >
                      Delete project…
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </main>
      </div>

      <ConfirmModal
        open={deleteOpen}
        title="Delete this project?"
        description={`This permanently deletes "${projectName}", all deployments, domains, logs, and environment variables for this project.`}
        confirmLabel="Delete project"
        cancelLabel="Cancel"
        busy={dangerBusy}
        destructive
        error={deleteError}
        onClose={() => {
          if (!dangerBusy) setDeleteOpen(false);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  danger,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-2.5 text-left text-sm transition-all lg:w-full ${
        active
          ? danger
            ? "border-red-400/50 bg-red-500/15 text-red-100"
            : "border-basil-400/50 bg-basil-500/15 text-basil-100"
          : danger
            ? "border-white/10 bg-transparent text-red-200/70 hover:border-red-400/30 hover:bg-red-500/10"
            : "border-white/10 bg-white/[0.02] text-white/65 hover:border-basil-400/30 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function EnvVarsPanel({
  userId,
  projectId,
  rows,
  tableAvailable,
  onRefresh,
  flashToast,
}: {
  userId: string;
  projectId: string;
  rows: EnvVarRow[];
  tableAvailable: boolean;
  onRefresh: () => void;
  flashToast: (tone: "success" | "error" | "info", text: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [newEnv, setNewEnv] = useState<EnvScope>("production");
  const [newSecret, setNewSecret] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editVal, setEditVal] = useState("");
  const [editEnv, setEditEnv] = useState<EnvScope>("production");
  const [editSecret, setEditSecret] = useState(true);
  const [editBusy, setEditBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const k = newKey.trim();
    if (!k) {
      flashToast("error", "Variable key is required.");
      return;
    }
    setSubmitBusy(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        user_id: userId,
        project_id: projectId,
        key: k,
        value: newVal,
        environment: newEnv,
        is_secret: newSecret,
        created_at: now,
        updated_at: now,
      };
      const { error } = await supabase
        .from("project_environment_variables")
        .insert(payload);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      flashToast("success", "Environment variable added.");
      setNewKey("");
      setNewVal("");
      setNewEnv("production");
      setNewSecret(true);
      setAdding(false);
      onRefresh();
    } finally {
      setSubmitBusy(false);
    }
  }

  function startEdit(row: EnvVarRow) {
    setEditingId(row.id);
    setEditKey(row.key ?? "");
    setEditVal(row.value ?? "");
    setEditEnv(normalizeEnvScope(row.environment));
    setEditSecret(row.is_secret !== false);
  }

  async function saveEdit() {
    if (!editingId) return;
    const k = editKey.trim();
    if (!k) {
      flashToast("error", "Key is required.");
      return;
    }
    setEditBusy(true);
    try {
      const { error } = await supabase
        .from("project_environment_variables")
        .update({
          key: k,
          value: editVal,
          environment: editEnv,
          is_secret: editSecret,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingId)
        .eq("user_id", userId)
        .eq("project_id", projectId);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      flashToast("success", "Variable updated.");
      setEditingId(null);
      onRefresh();
    } finally {
      setEditBusy(false);
    }
  }

  async function removeRow(id: string) {
    setEditBusy(true);
    try {
      const { error } = await supabase
        .from("project_environment_variables")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .eq("project_id", projectId);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      flashToast("info", "Variable removed.");
      if (editingId === id) setEditingId(null);
      onRefresh();
    } finally {
      setEditBusy(false);
    }
  }

  async function copyKey(id: string, key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      flashToast("error", "Could not copy to clipboard.");
    }
  }

  if (!tableAvailable) {
    return (
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
          // environment
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          Environment variables
        </h2>
        <p className="mt-2 text-sm text-white/55">
          Create the table{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-basil-200/90">
            public.project_environment_variables
          </code>{" "}
          in Supabase with columns: id, user_id, project_id, key, value,
          environment, is_secret, created_at, updated_at. Then refresh this page.
        </p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // environment
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Encrypted variables
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/50">
            Scoped to production, preview, or development. Values are stored for
            demo purposes — treat production secrets with care.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-xs font-medium text-basil-100 transition-colors hover:bg-basil-500/20"
        >
          {adding ? "Close form" : "＋ Add variable"}
        </button>
      </div>

      {adding ? (
        <form
          onSubmit={handleAdd}
          className="mt-6 rounded-2xl border border-basil-400/20 bg-black/45 p-4 backdrop-blur-xl"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-white/45">
                Key
              </label>
              <input
                className={`${inputClass} font-mono text-sm`}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="API_URL"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-white/45">
                Value
              </label>
              <input
                className={`${inputClass} font-mono text-sm`}
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-white/45">
                Environment
              </label>
              <select
                className={inputClass}
                value={newEnv}
                onChange={(e) => setNewEnv(e.target.value as EnvScope)}
              >
                {ENV_OPTIONS.map((env) => (
                  <option key={env} value={env} className="bg-black capitalize">
                    {env}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={newSecret}
                  onChange={(e) => setNewSecret(e.target.checked)}
                  className="rounded border-white/20 bg-black/60 text-basil-400 focus:ring-basil-400/30"
                />
                Mark as secret
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitBusy}
              className="rounded-full bg-gradient-to-r from-basil-300 to-basil-500 px-5 py-2 text-xs font-semibold text-black disabled:opacity-50"
            >
              {submitBusy ? "Adding…" : "Save variable"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-black/40">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-white/40">
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Environment</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-white/45"
                >
                  No variables yet. Add one to inject at build/runtime.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isEdit = editingId === row.id;
                const secret = row.is_secret !== false;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="px-4 py-3 align-top font-mono text-xs text-basil-100/90">
                      {isEdit ? (
                        <input
                          className={`${inputClass} !py-2 text-xs`}
                          value={editKey}
                          onChange={(e) => setEditKey(e.target.value)}
                        />
                      ) : (
                        <span className="break-all">{row.key}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {isEdit ? (
                        <select
                          className={`${inputClass} !py-2 text-xs`}
                          value={editEnv}
                          onChange={(e) =>
                            setEditEnv(e.target.value as EnvScope)
                          }
                        >
                          {ENV_OPTIONS.map((env) => (
                            <option key={env} value={env} className="bg-black capitalize">
                              {env}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-white/70">
                          {normalizeEnvScope(row.environment)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs text-white/70">
                      {isEdit ? (
                        <input
                          className={`${inputClass} !py-2 text-xs`}
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                        />
                      ) : secret ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="tracking-widest text-white/35">••••••••</span>
                          <span className="rounded border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-cyan-200/90">
                            Encrypted
                          </span>
                        </span>
                      ) : (
                        <span className="break-all">{row.value ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {isEdit ? (
                          <>
                            <button
                              type="button"
                              disabled={editBusy}
                              onClick={() => void saveEdit()}
                              className="rounded-full border border-basil-400/40 bg-basil-500/10 px-2.5 py-1 text-[10px] text-basil-100 hover:bg-basil-500/20 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={editBusy}
                              onClick={() => setEditingId(null)}
                              className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-white/60 hover:bg-white/5"
                            >
                              Cancel
                            </button>
                            <label className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">
                              <input
                                type="checkbox"
                                checked={editSecret}
                                onChange={(e) => setEditSecret(e.target.checked)}
                                className="rounded border-white/20"
                              />
                              Secret
                            </label>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                void copyKey(row.id, row.key ?? "")
                              }
                              className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-white/65 hover:border-basil-400/40"
                            >
                              {copiedId === row.id ? "Copied" : "Copy key"}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-white/65 hover:border-basil-400/40"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={editBusy}
                              onClick={() => void removeRow(row.id)}
                              className="rounded-full border border-red-400/30 px-2.5 py-1 text-[10px] text-red-200/90 hover:bg-red-500/10 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function NotFoundShell({ projectId }: { projectId: string }) {
  return (
    <div className="relative grid min-h-screen place-items-center bg-black px-4 text-white">
      <BackgroundFX />
      <div className="relative z-10 w-full max-w-md text-center">
        <div className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-8 backdrop-blur-2xl">
          <h1 className="text-xl font-semibold">Project not found</h1>
          <p className="mt-2 text-sm text-white/55">
            No project with id{" "}
            <span className="font-mono text-basil-200/80">{projectId}</span>{" "}
            belongs to your account.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 inline-flex rounded-full bg-gradient-to-r from-basil-300 to-basil-500 px-5 py-2 text-sm font-semibold text-black"
          >
            ← Dashboard
          </Link>
        </div>
      </div>
    </div>
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
