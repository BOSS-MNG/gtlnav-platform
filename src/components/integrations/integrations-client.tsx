"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { absoluteTime, relativeTime } from "@/src/lib/dashboard-format";
import {
  BitbucketIcon,
  GitHubIcon,
  GitLabIcon,
  type IconProps,
} from "@/src/components/ui/icons";

type Provider = "github" | "gitlab" | "bitbucket";

type GitIntegrationRow = {
  id: string;
  user_id?: string | null;
  provider?: string | null;
  status?: string | null;
  provider_account?: string | null;
  connected_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type ProjectRow = {
  id: string;
  user_id?: string | null;
  name?: string | null;
  slug?: string | null;
  framework?: string | null;
  provider?: string | null;
  status?: string | null;
  repo_url?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

type ProviderMeta = {
  value: Provider;
  label: string;
  tagline: string;
  description: string;
  defaultAccount: string;
  features: string[];
  /** Brand-tinted classes for the icon container badge. */
  badgeClass: string;
  Icon: ComponentType<IconProps>;
};

const PROVIDERS: ProviderMeta[] = [
  {
    value: "github",
    label: "GitHub",
    tagline: "OAuth + webhooks",
    description:
      "Import repositories, deploy on push, and ship pull request previews. Fine-grained tokens supported.",
    defaultAccount: "godtechlabs",
    features: [
      "Import repository",
      "Branch deploy",
      "Webhook deploy",
      "Pull request preview",
    ],
    badgeClass:
      "border-white/15 bg-gradient-to-br from-zinc-100 to-zinc-300 text-black",
    Icon: GitHubIcon,
  },
  {
    value: "gitlab",
    label: "GitLab",
    tagline: "OAuth + project access tokens",
    description:
      "Source from GitLab.com or self-managed. Trigger pipelines and previews per merge request.",
    defaultAccount: "godtechlabs",
    features: [
      "Import repository",
      "Branch deploy",
      "Webhook deploy",
      "Merge request preview",
    ],
    badgeClass:
      "border-orange-400/30 bg-gradient-to-br from-orange-400/30 via-amber-400/20 to-rose-400/15 text-orange-200",
    Icon: GitLabIcon,
  },
  {
    value: "bitbucket",
    label: "Bitbucket",
    tagline: "OAuth + repository tokens",
    description:
      "Connect a workspace and deploy on commits to any branch. Preview environments per pull request.",
    defaultAccount: "godtechlabs",
    features: [
      "Import repository",
      "Branch deploy",
      "Webhook deploy",
      "Pull request preview",
    ],
    badgeClass:
      "border-sky-400/30 bg-gradient-to-br from-sky-400/30 via-indigo-400/20 to-violet-500/15 text-sky-200",
    Icon: BitbucketIcon,
  },
];

type SimulatedRepo = {
  fullName: string; // org/repo
  defaultBranch: string;
  framework: string;
  lastPushedAt: string; // ISO
  language?: string;
};

const SIMULATED_REPOS_BY_PROVIDER: Record<Provider, SimulatedRepo[]> = {
  github: [
    {
      fullName: "godtechlabs/gtlnav-demo",
      defaultBranch: "main",
      framework: "Next.js",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
      language: "TypeScript",
    },
    {
      fullName: "godtechlabs/marketing-site",
      defaultBranch: "main",
      framework: "Astro",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      language: "TypeScript",
    },
    {
      fullName: "godtechlabs/jere-landing",
      defaultBranch: "main",
      framework: "Next.js",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 60 * 27).toISOString(),
      language: "TypeScript",
    },
    {
      fullName: "personal/portfolio-next",
      defaultBranch: "main",
      framework: "Next.js",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 60 * 90).toISOString(),
      language: "TypeScript",
    },
  ],
  gitlab: [
    {
      fullName: "godtechlabs/edge-gateway",
      defaultBranch: "main",
      framework: "Custom",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 80).toISOString(),
      language: "Go",
    },
    {
      fullName: "godtechlabs/internal-tools",
      defaultBranch: "main",
      framework: "Vite",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      language: "TypeScript",
    },
  ],
  bitbucket: [
    {
      fullName: "godtechlabs/legacy-cms",
      defaultBranch: "develop",
      framework: "Static",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
      language: "PHP",
    },
    {
      fullName: "godtechlabs/api-clients",
      defaultBranch: "main",
      framework: "Custom",
      lastPushedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      language: "TypeScript",
    },
  ],
};

const BRANCH_PREVIEWS = ["main", "staging", "preview", "production"] as const;

const REPO_BASE_URL: Record<Provider, string> = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  bitbucket: "https://bitbucket.org",
};

function isMissingTableError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("not found")
  );
}

function slugifyRepo(fullName: string) {
  const seg = fullName.split("/").pop() ?? fullName;
  return seg
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function repoUrl(provider: Provider, fullName: string) {
  return `${REPO_BASE_URL[provider]}/${fullName}`;
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
    source: "integrations",
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

type LoadResult = {
  integrations: GitIntegrationRow[];
  projects: ProjectRow[];
  tableAvailable: boolean;
  errors: string[];
};

async function loadIntegrations(userId: string): Promise<LoadResult> {
  const errors: string[] = [];

  const integrationsRes = await supabase
    .from("git_integrations")
    .select("*")
    .eq("user_id", userId)
    .order("connected_at", { ascending: false });

  let tableAvailable = true;
  let integrations: GitIntegrationRow[] = [];

  if (integrationsRes.error) {
    if (isMissingTableError(integrationsRes.error.message)) {
      tableAvailable = false;
    } else {
      errors.push(`git_integrations: ${integrationsRes.error.message}`);
    }
  } else {
    integrations = (integrationsRes.data ?? []) as GitIntegrationRow[];
  }

  const projectsRes = await supabase
    .from("projects")
    .select("id, name, slug, framework, provider, status, repo_url, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (projectsRes.error) {
    errors.push(`projects: ${projectsRes.error.message}`);
  }

  return {
    integrations,
    projects: (projectsRes.data ?? []) as ProjectRow[],
    tableAvailable,
    errors,
  };
}

export function IntegrationsClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tableAvailable, setTableAvailable] = useState(true);
  const [integrations, setIntegrations] = useState<GitIntegrationRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [importingRepo, setImportingRepo] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [activeProvider, setActiveProvider] = useState<Provider>("github");

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
        const result = await loadIntegrations(userId);
        setIntegrations(result.integrations);
        setProjects(result.projects);
        setTableAvailable(result.tableAvailable);
        setLoadErrors(result.errors);
      } catch (e) {
        setLoadErrors([
          e instanceof Error ? e.message : "Failed to load integrations.",
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

  const integrationByProvider = useMemo(() => {
    const map = new Map<Provider, GitIntegrationRow>();
    for (const row of integrations) {
      const p = (row.provider ?? "").toLowerCase() as Provider;
      if (PROVIDERS.some((meta) => meta.value === p)) {
        // keep latest only (already ordered by connected_at desc)
        if (!map.has(p)) map.set(p, row);
      }
    }
    return map;
  }, [integrations]);

  const importedRepoUrls = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      if (p.repo_url) set.add(p.repo_url.toLowerCase());
    }
    return set;
  }, [projects]);

  const importedFromGit = useMemo(
    () => projects.filter((p) => Boolean(p.repo_url)),
    [projects],
  );

  function isConnected(provider: Provider) {
    const row = integrationByProvider.get(provider);
    return Boolean(row && (row.status ?? "").toLowerCase() === "connected");
  }

  async function handleConnect(provider: Provider) {
    const uid = session?.user?.id;
    if (!uid) return;
    if (!tableAvailable) {
      flashToast("error", "Run the setup SQL below to enable integrations.");
      return;
    }
    setBusyProvider(provider);
    try {
      const meta = PROVIDERS.find((p) => p.value === provider)!;
      const now = new Date().toISOString();
      const existing = integrationByProvider.get(provider);

      if (existing) {
        const { error } = await supabase
          .from("git_integrations")
          .update({
            status: "connected",
            connected_at: now,
            updated_at: now,
            provider_account: meta.defaultAccount,
            metadata: {
              scopes: ["repo", "deployment", "webhooks"],
              simulated: true,
            },
          })
          .eq("id", existing.id)
          .eq("user_id", uid);
        if (error) {
          flashToast("error", error.message);
          return;
        }
      } else {
        const fullPayload = {
          user_id: uid,
          provider,
          status: "connected",
          provider_account: meta.defaultAccount,
          connected_at: now,
          metadata: {
            scopes: ["repo", "deployment", "webhooks"],
            simulated: true,
          },
          created_at: now,
          updated_at: now,
        };
        let { error } = await supabase
          .from("git_integrations")
          .insert(fullPayload);
        if (error) {
          const fallback = await supabase.from("git_integrations").insert({
            user_id: uid,
            provider,
            status: "connected",
            provider_account: meta.defaultAccount,
            connected_at: now,
          });
          error = fallback.error;
        }
        if (error) {
          if (isMissingTableError(error.message)) {
            setTableAvailable(false);
            flashToast(
              "error",
              "git_integrations table is missing. See setup SQL below.",
            );
            return;
          }
          flashToast("error", error.message);
          return;
        }
      }

      await insertInfraLog(
        uid,
        null,
        "git_provider_connected",
        `${meta.label} connected to GTLNAV.`,
        "success",
        { provider, account: meta.defaultAccount },
      );
      flashToast("success", `${meta.label} connected.`);
      setActiveProvider(provider);
      await refresh(uid, "refresh");
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleDisconnect(provider: Provider) {
    const uid = session?.user?.id;
    if (!uid) return;
    const existing = integrationByProvider.get(provider);
    if (!existing) return;
    setBusyProvider(provider);
    try {
      const meta = PROVIDERS.find((p) => p.value === provider)!;
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("git_integrations")
        .update({
          status: "disconnected",
          updated_at: now,
        })
        .eq("id", existing.id)
        .eq("user_id", uid);
      if (error) {
        flashToast("error", error.message);
        return;
      }
      await insertInfraLog(
        uid,
        null,
        "git_provider_disconnected",
        `${meta.label} disconnected from GTLNAV.`,
        "warning",
        { provider, account: existing.provider_account ?? null },
      );
      flashToast("info", `${meta.label} disconnected.`);
      await refresh(uid, "refresh");
    } finally {
      setBusyProvider(null);
    }
  }

  async function handleImport(provider: Provider, repo: SimulatedRepo) {
    const uid = session?.user?.id;
    if (!uid) return;
    const url = repoUrl(provider, repo.fullName);
    if (importedRepoUrls.has(url.toLowerCase())) {
      flashToast("info", "This repository is already imported.");
      return;
    }
    setImportingRepo(repo.fullName);
    try {
      const slugBase = slugifyRepo(repo.fullName);
      const slug = projects.some((p) => (p.slug ?? "") === slugBase)
        ? `${slugBase}-${Math.random().toString(36).slice(2, 6)}`
        : slugBase;
      const repoName = repo.fullName.split("/").pop() ?? repo.fullName;
      const now = new Date().toISOString();
      const fullPayload = {
        user_id: uid,
        name: repoName,
        slug,
        framework: repo.framework,
        provider: "gtlnav_edge",
        status: "active",
        repo_url: url,
        created_at: now,
        updated_at: now,
      };
      let { error } = await supabase.from("projects").insert(fullPayload);
      if (error) {
        const fallback = await supabase.from("projects").insert({
          user_id: uid,
          name: repoName,
          slug,
          framework: repo.framework,
          provider: "gtlnav_edge",
          status: "active",
          repo_url: url,
        });
        error = fallback.error;
      }
      if (error) {
        flashToast("error", error.message);
        return;
      }
      await insertInfraLog(
        uid,
        null,
        "repo_imported",
        `Repository ${repo.fullName} imported as GTLNAV project.`,
        "success",
        {
          provider,
          repo: repo.fullName,
          framework: repo.framework,
          default_branch: repo.defaultBranch,
        },
      );
      flashToast("success", `${repoName} imported.`);
      await refresh(uid, "refresh");
    } finally {
      setImportingRepo(null);
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
  const connectedProviders = PROVIDERS.filter((p) => isConnected(p.value));
  const repoList =
    SIMULATED_REPOS_BY_PROVIDER[activeProvider] ?? [];

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
        <DashboardSidebar activeKey="integrations" userEmail={user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // integrations
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Git providers
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                Connect GitHub, GitLab, or Bitbucket to import repositories,
                deploy on push, and ship pull request previews on the GTLNAV
                edge.
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

          {!tableAvailable ? <MissingTablePanel /> : null}

          <section className="mt-8 grid gap-4 lg:grid-cols-3">
            {PROVIDERS.map((meta) => (
              <ProviderCard
                key={meta.value}
                meta={meta}
                row={integrationByProvider.get(meta.value)}
                connected={isConnected(meta.value)}
                busy={busyProvider === meta.value}
                onConnect={() => void handleConnect(meta.value)}
                onDisconnect={() => void handleDisconnect(meta.value)}
                disabled={!tableAvailable}
              />
            ))}
          </section>

          {connectedProviders.length > 0 ? (
            <section className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                    // import
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-white">
                    Import repository
                  </h2>
                  <p className="mt-1 max-w-xl text-sm text-white/55">
                    Pick a connected provider and import a repository as a
                    GTLNAV project. Repositories shown here are simulated and
                    safe to import.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {connectedProviders.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setActiveProvider(p.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition-all ${
                        activeProvider === p.value
                          ? "border-basil-400/50 bg-basil-500/15 text-basil-100"
                          : "border-white/10 bg-white/[0.03] text-white/55 hover:border-basil-400/30 hover:text-white"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {!isConnected(activeProvider) ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 px-4 py-6 text-sm text-white/55">
                  Connect{" "}
                  {PROVIDERS.find((p) => p.value === activeProvider)?.label} to
                  see importable repositories.
                </div>
              ) : (
                <ul className="mt-6 space-y-3">
                  {repoList.map((repo) => {
                    const url = repoUrl(activeProvider, repo.fullName);
                    const alreadyImported = importedRepoUrls.has(
                      url.toLowerCase(),
                    );
                    return (
                      <RepoRow
                        key={repo.fullName}
                        provider={activeProvider}
                        repo={repo}
                        alreadyImported={alreadyImported}
                        importing={importingRepo === repo.fullName}
                        onImport={() => void handleImport(activeProvider, repo)}
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

          {importedFromGit.length > 0 ? (
            <section className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                // branch-deploy
              </p>
              <h2 className="mt-2 text-lg font-semibold text-white">
                Branch deploy preview
              </h2>
              <p className="mt-1 max-w-xl text-sm text-white/55">
                Future-ready branch routing for repositories imported into
                GTLNAV. Each branch maps to its own preview environment when
                webhooks fire.
              </p>

              <ul className="mt-6 space-y-3">
                {importedFromGit.slice(0, 6).map((p) => (
                  <BranchRow key={p.id} project={p} />
                ))}
              </ul>
            </section>
          ) : null}

          {loading ? <SkeletonGrid /> : null}
        </main>
      </div>
    </div>
  );
}

function ProviderCard({
  meta,
  row,
  connected,
  busy,
  onConnect,
  onDisconnect,
  disabled,
}: {
  meta: ProviderMeta;
  row?: GitIntegrationRow;
  connected: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  disabled: boolean;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-3xl border p-6 backdrop-blur-xl transition-colors ${
        connected
          ? "border-basil-400/35 bg-gradient-to-br from-basil-500/[0.08] via-white/[0.02] to-transparent"
          : "border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.01] to-transparent hover:border-basil-400/25"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
          connected ? "via-basil-300/60" : "via-white/15"
        } to-transparent`}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border ${meta.badgeClass}`}
            >
              <meta.Icon className="h-5 w-5" title={meta.label} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {meta.label}
              </h3>
              <p className="text-[10px] uppercase tracking-[0.22em] text-white/45">
                {meta.tagline}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/60">{meta.description}</p>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
            connected
              ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
              : "border-white/10 bg-white/[0.04] text-white/55"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected
                ? "bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.95)]"
                : "bg-white/35"
            }`}
          />
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <ul className="mt-5 grid gap-1.5 text-[11px] text-white/65 sm:grid-cols-2">
        {meta.features.map((f) => (
          <li key={f} className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-1 rounded-full bg-basil-300/80" />
            {f}
          </li>
        ))}
      </ul>

      {connected && row ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-white/55">
          <RowKV k="account" v={row.provider_account ?? "—"} />
          <RowKV
            k="connected"
            v={
              row.connected_at
                ? `${relativeTime(row.connected_at)}`
                : "just now"
            }
            title={absoluteTime(row.connected_at)}
          />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-full border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
            <button
              type="button"
              onClick={onConnect}
              disabled={busy}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white disabled:opacity-50"
            >
              Reconnect
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={busy || disabled}
            className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-xs font-semibold text-black shadow-[0_0_24px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_36px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Connecting…" : `Connect ${meta.label}`}
          </button>
        )}
        {meta.value === "github" ? (
          <Link
            href="/dashboard/integrations/github"
            className="ml-auto rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/65 transition-colors hover:border-basil-400/40 hover:text-white"
            title="Real GitHub OAuth + repo sync (server-side)"
          >
            Real OAuth →
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function RepoRow({
  provider,
  repo,
  alreadyImported,
  importing,
  onImport,
}: {
  provider: Provider;
  repo: SimulatedRepo;
  alreadyImported: boolean;
  importing: boolean;
  onImport: () => void;
}) {
  return (
    <li className="rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-basil-400/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-sm text-white">
              {repo.fullName}
            </p>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/55">
              {provider}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-white/70">
              {repo.framework}
            </span>
            <span className="text-white/45">·</span>
            <span className="font-mono text-white/65">
              branch: {repo.defaultBranch}
            </span>
            {repo.language ? (
              <>
                <span className="text-white/45">·</span>
                <span>{repo.language}</span>
              </>
            ) : null}
            <span className="text-white/45">·</span>
            <span title={absoluteTime(repo.lastPushedAt)}>
              Pushed {relativeTime(repo.lastPushedAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {alreadyImported ? (
            <span className="rounded-full border border-basil-400/30 bg-basil-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-basil-100">
              Imported
            </span>
          ) : (
            <button
              type="button"
              onClick={onImport}
              disabled={importing}
              className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-1.5 text-xs font-semibold text-black shadow-[0_0_18px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_26px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function BranchRow({ project }: { project: ProjectRow }) {
  return (
    <li className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/projects/${project.id}`}
              className="truncate text-sm font-medium text-white hover:text-basil-200"
            >
              {project.name ?? project.slug ?? "Project"}
            </Link>
            {project.framework ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/55">
                {project.framework}
              </span>
            ) : null}
          </div>
          {project.repo_url ? (
            <a
              href={project.repo_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block truncate font-mono text-[11px] text-white/45 hover:text-basil-300"
            >
              {project.repo_url}
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {BRANCH_PREVIEWS.map((branch) => (
            <span
              key={branch}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                branch === "production"
                  ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
                  : branch === "preview"
                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                    : branch === "staging"
                      ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
                      : "border-white/10 bg-white/[0.04] text-white/65"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  branch === "production"
                    ? "bg-basil-300 shadow-[0_0_6px_rgba(111,232,154,0.9)]"
                    : "bg-white/40"
                }`}
              />
              {branch}
            </span>
          ))}
        </div>
      </div>
    </li>
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
        Git integrations table is missing
      </h2>
      <p className="mt-1 max-w-xl text-sm text-white/60">
        Run this SQL in Supabase to enable Connect / Disconnect tracking. The
        rest of the integrations console works in read-only mode until then.
      </p>
      <pre className="mt-5 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-[11px] text-basil-200/90">
{`create table public.git_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  status text not null default 'connected',
  provider_account text,
  connected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.git_integrations enable row level security;

create policy "git_integrations are user-owned"
  on public.git_integrations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);`}
      </pre>
    </section>
  );
}

function SkeletonGrid() {
  return (
    <section className="mt-10 grid gap-4 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]"
        />
      ))}
    </section>
  );
}

function RowKV({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between first:mt-0">
      <span className="text-basil-300/80">{k}</span>
      <span title={title} className="truncate pl-3 text-right text-white/85">
        {v}
      </span>
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
