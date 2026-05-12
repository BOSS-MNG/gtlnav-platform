"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { absoluteTime, relativeTime } from "@/src/lib/dashboard-format";
import { GitHubIcon } from "@/src/components/ui/icons";

type GitHubAccountRow = {
  id?: string;
  user_id?: string | null;
  github_user_id?: number | null;
  github_login?: string | null;
  github_user_type?: string | null;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  status?: string | null;
  token_scope?: string | null;
  token_type?: string | null;
  expires_at?: string | null;
  refresh_token_expires_at?: string | null;
  connected_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type GitHubRepoRow = {
  id?: string;
  user_id?: string | null;
  github_account_id?: string | null;
  github_repo_id?: number | null;
  full_name?: string | null;
  name?: string | null;
  owner_login?: string | null;
  owner_type?: string | null;
  html_url?: string | null;
  clone_url?: string | null;
  default_branch?: string | null;
  is_private?: boolean | null;
  is_archived?: boolean | null;
  is_fork?: boolean | null;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number | null;
  pushed_at?: string | null;
  synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type Toast = { tone: "success" | "error" | "info"; text: string } | null;

type LoadState = "loading" | "ready" | "redirect";

const ERROR_LABELS: Record<string, string> = {
  state_mismatch: "OAuth state mismatch — please try connecting again.",
  missing_code: "GitHub did not return an authorization code.",
  oauth_misconfigured:
    "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET on the server.",
  token_exchange_failed: "Could not exchange the GitHub authorization code.",
  viewer_lookup_failed: "GitHub returned an error fetching your profile.",
  supabase_unconfigured: "Server Supabase keys are missing.",
  store_failed: "Could not store the GitHub account row.",
  session_lost: "OAuth session expired. Try connecting again.",
  access_denied: "You declined the GitHub authorization.",
};

export default function GitHubIntegrationClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<GitHubAccountRow | null>(null);
  const [repos, setRepos] = useState<GitHubRepoRow[]>([]);
  const [accountsMissing, setAccountsMissing] = useState(false);
  const [reposMissing, setReposMissing] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [filter, setFilter] = useState("");
  const flashedRef = useRef(false);

  const flashToast = useCallback((tone: "success" | "error" | "info", text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const refresh = useCallback(
    async (uid: string, kind: "initial" | "refresh" = "refresh") => {
      if (kind === "refresh") setRefreshing(true);
      const errs: string[] = [];

      const accountResp = await supabase
        .from("github_accounts")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();
      if (accountResp.error) {
        if (isMissingTable(accountResp.error.message)) {
          setAccountsMissing(true);
        } else {
          errs.push(`github_accounts: ${accountResp.error.message}`);
        }
        setAccount(null);
      } else {
        setAccount((accountResp.data as GitHubAccountRow | null) ?? null);
        setAccountsMissing(false);
      }

      const reposResp = await supabase
        .from("github_repositories")
        .select("*")
        .eq("user_id", uid)
        .order("pushed_at", { ascending: false })
        .limit(200);
      if (reposResp.error) {
        if (isMissingTable(reposResp.error.message)) {
          setReposMissing(true);
        } else {
          errs.push(`github_repositories: ${reposResp.error.message}`);
        }
        setRepos([]);
      } else {
        setRepos(((reposResp.data as GitHubRepoRow[] | null) ?? []).slice());
        setReposMissing(false);
      }

      setLoadErrors(errs);
      if (kind === "refresh") setRefreshing(false);
    },
    [],
  );

  // ---- Auth bootstrap -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const next = data.session ?? null;
      if (cancelled) return;
      if (!next) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/integrations/github");
        return;
      }
      setSession(next);
      await refresh(next.user.id, "initial");
      setLoadState("ready");
    })();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        if (cancelled) return;
        if (!next) {
          setSession(null);
          setLoadState("redirect");
          router.replace("/login?next=/dashboard/integrations/github");
          return;
        }
        setSession(next);
      },
    );
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [refresh, router]);

  // ---- Surface ?connected=1 / ?error=... once ----------------------------
  useEffect(() => {
    if (loadState !== "ready") return;
    if (flashedRef.current) return;
    const connected = searchParams.get("connected");
    const errorKey = searchParams.get("error");
    const login = searchParams.get("login");
    if (connected === "1") {
      flashedRef.current = true;
      flashToast(
        "success",
        login ? `Connected GitHub @${login}.` : "GitHub connected.",
      );
      const url = new URL(window.location.href);
      ["connected", "login", "error", "detail"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, "", url.toString());
    } else if (errorKey) {
      flashedRef.current = true;
      flashToast(
        "error",
        ERROR_LABELS[errorKey] ?? `GitHub OAuth failed: ${errorKey}`,
      );
      const url = new URL(window.location.href);
      ["connected", "login", "error", "detail"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, "", url.toString());
    }
  }, [loadState, searchParams, flashToast]);

  // ---- Actions -----------------------------------------------------------
  const handleConnect = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const resp = await fetch("/api/oauth/github/start", {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json",
        },
      });
      const json = (await resp.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
        message?: string;
      };
      if (!resp.ok || !json.url) {
        flashToast(
          "error",
          json.message ?? json.error ?? "Could not start GitHub OAuth.",
        );
        setBusy(false);
        return;
      }
      window.location.href = json.url;
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Network error starting OAuth.",
      );
      setBusy(false);
    }
  }, [session, flashToast]);

  const handleDisconnect = useCallback(async () => {
    if (!session) return;
    if (!window.confirm("Disconnect this GitHub account from GTLNAV?")) return;
    setBusy(true);
    try {
      const resp = await fetch("/api/oauth/github/disconnect", {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json",
        },
      });
      const json = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!resp.ok || !json.ok) {
        flashToast(
          "error",
          json.message ?? json.error ?? "Disconnect failed.",
        );
        return;
      }
      flashToast("info", "GitHub disconnected.");
      await refresh(session.user.id);
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Network error during disconnect.",
      );
    } finally {
      setBusy(false);
    }
  }, [session, flashToast, refresh]);

  const handleSync = useCallback(async () => {
    if (!session) return;
    setSyncing(true);
    try {
      const resp = await fetch("/api/oauth/github/sync", {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json",
        },
      });
      const json = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        written?: number;
        fetched?: number;
      };
      if (!resp.ok || !json.ok) {
        flashToast(
          "error",
          json.message ?? json.error ?? "Repository sync failed.",
        );
        return;
      }
      flashToast(
        "success",
        `Synced ${json.written ?? 0} of ${json.fetched ?? 0} repositories.`,
      );
      await refresh(session.user.id);
    } catch (err) {
      flashToast(
        "error",
        err instanceof Error ? err.message : "Network error during sync.",
      );
    } finally {
      setSyncing(false);
    }
  }, [session, flashToast, refresh]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  // ---- Derived UI state --------------------------------------------------
  const isConnected = useMemo(() => {
    if (!account) return false;
    const status = (account.status ?? "").toLowerCase();
    return status === "connected" || Boolean(account.github_login);
  }, [account]);

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      `${r.full_name ?? ""} ${r.description ?? ""} ${r.language ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [repos, filter]);

  const ownerCount = useMemo(() => {
    return new Set(
      repos
        .map((r) => (r.owner_login ?? "").toString())
        .filter((v) => v.length > 0),
    ).size;
  }, [repos]);

  const privateCount = useMemo(
    () => repos.filter((r) => Boolean(r.is_private)).length,
    [repos],
  );

  const lastSync = useMemo(() => {
    return repos
      .map((r) => r.synced_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1);
  }, [repos]);

  if (loadState === "loading") {
    return <FullPageMessage label="Verifying session…" />;
  }
  if (loadState === "redirect" || !session) {
    return <FullPageMessage label="Redirecting to sign in…" />;
  }

  const tablesMissing = accountsMissing || reposMissing;

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
        <DashboardSidebar
          activeKey="integrations"
          userEmail={session.user.email}
        />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // integrations / github
              </p>
              <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/15 bg-gradient-to-br from-zinc-100 to-zinc-300 text-black">
                  <GitHubIcon />
                </span>
                GitHub OAuth
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                Real GitHub authorization. GTLNAV exchanges your code on the
                server, encrypts the access token at rest, and never exposes
                client secrets to the browser.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/dashboard/integrations"
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                ← All integrations
              </Link>
              <button
                type="button"
                onClick={() => void refresh(session.user.id, "refresh")}
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

          {tablesMissing ? <SchemaSetupPanel /> : null}

          <section className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <ConnectionCard
              connected={isConnected}
              account={account}
              busy={busy}
              onConnect={() => void handleConnect()}
              onDisconnect={() => void handleDisconnect()}
              tablesMissing={tablesMissing}
            />
            <ArchitectureCard />
          </section>

          <section className="mt-10 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                  // repositories
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  Synced repositories
                </h2>
                <p className="mt-1 max-w-xl text-sm text-white/55">
                  GTLNAV fetches repos through your OAuth token. Branch
                  metadata and webhook installs activate once a repository is
                  imported as a project.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name, language…"
                  className="w-64 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-basil-400/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSync()}
                  disabled={syncing || !isConnected}
                  className="rounded-full border border-basil-400/40 bg-basil-500/15 px-4 py-2 text-xs font-medium text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-400/20 disabled:opacity-40"
                >
                  {syncing ? "Syncing…" : "Sync repositories"}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Repositories" value={repos.length.toString()} />
              <Stat label="Owners / orgs" value={ownerCount.toString()} />
              <Stat label="Private" value={privateCount.toString()} />
              <Stat
                label="Last sync"
                value={lastSync ? relativeTime(lastSync) : "—"}
                hint={lastSync ? absoluteTime(lastSync) : undefined}
              />
            </div>

            {!isConnected ? (
              <EmptyRepoState onConnect={() => void handleConnect()} busy={busy} />
            ) : repos.length === 0 ? (
              <PendingSyncState onSync={() => void handleSync()} busy={syncing} />
            ) : (
              <RepoList rows={filteredRepos} />
            )}
          </section>

          <FuturesGrid />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Subcomponents
// ---------------------------------------------------------------------------

function ConnectionCard({
  connected,
  account,
  busy,
  onConnect,
  onDisconnect,
  tablesMissing,
}: {
  connected: boolean;
  account: GitHubAccountRow | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  tablesMissing: boolean;
}) {
  const scopes = (account?.token_scope ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-gradient-to-br from-zinc-100 to-zinc-300 text-black shadow-[0_0_30px_rgba(255,255,255,0.08)]">
            <GitHubIcon />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">
                {connected
                  ? account?.github_login
                    ? `@${account.github_login}`
                    : "GitHub connected"
                  : "Connect GitHub"}
              </h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                  connected
                    ? "border-basil-400/40 bg-basil-500/15 text-basil-100"
                    : "border-white/10 bg-white/[0.04] text-white/60"
                }`}
              >
                <span
                  className={`block h-1.5 w-1.5 rounded-full ${
                    connected
                      ? "bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.9)]"
                      : "bg-white/40"
                  }`}
                />
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <p className="mt-1 text-sm text-white/55">
              {connected
                ? "GTLNAV holds an encrypted access token for this account. Tokens never leave the server."
                : "Authorize GTLNAV to read your repositories, install webhooks, and ship deployments."}
            </p>
            {connected ? (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoRow label="Account type" value={account?.github_user_type ?? "User"} />
                <InfoRow
                  label="Connected"
                  value={
                    account?.connected_at
                      ? `${relativeTime(account.connected_at)} · ${absoluteTime(account.connected_at)}`
                      : "—"
                  }
                />
                <InfoRow label="Token type" value={account?.token_type ?? "bearer"} />
                <InfoRow
                  label="Refresh expires"
                  value={
                    account?.refresh_token_expires_at
                      ? relativeTime(account.refresh_token_expires_at)
                      : "—"
                  }
                />
              </dl>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {connected ? (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-full border border-red-400/30 bg-red-500/10 px-5 py-2 text-xs font-medium text-red-100 transition-colors hover:border-red-300/60 hover:bg-red-400/20 disabled:opacity-50"
            >
              {busy ? "Working…" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={busy || tablesMissing}
              className="rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-400/20 disabled:opacity-40"
            >
              {busy ? "Redirecting…" : "Connect GitHub"}
            </button>
          )}
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">
            OAuth · server-side · AES-256-GCM
          </p>
        </div>
      </div>

      {connected && scopes.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {scopes.map((scope) => (
            <span
              key={scope}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/65"
            >
              {scope}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArchitectureCard() {
  const items: { title: string; body: string; status: string }[] = [
    {
      title: "OAuth handshake",
      body: "Browser ↔ /api/oauth/github/start → GitHub → /api/oauth/github/callback. State cookie verified server-side.",
      status: "live",
    },
    {
      title: "Token storage",
      body: "AES-256-GCM via GTLNAV_TOKEN_ENCRYPTION_KEY. Anon callers cannot read access_token_encrypted.",
      status: "live",
    },
    {
      title: "Repo + branch sync",
      body: "Pulled via the user's OAuth token. Branch listings activate when a repo is imported.",
      status: "live",
    },
    {
      title: "Token refresh",
      body: "Refresh-token grant wired (GitHub Apps); enable when refresh_token_expires_at is set.",
      status: "ready",
    },
    {
      title: "Webhook install",
      body: "Plan emitted per repo (push + pull_request). One-click install ships in the next phase.",
      status: "ready",
    },
    {
      title: "Organization sync",
      body: "read:org scope already requested. Org enumeration ships once team workspaces map to orgs.",
      status: "ready",
    },
  ];
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
        // architecture
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">
        How GTLNAV handles GitHub
      </h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-white">{item.title}</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
                  item.status === "live"
                    ? "border-basil-400/40 bg-basil-500/15 text-basil-100"
                    : "border-white/10 bg-white/[0.04] text-white/55"
                }`}
              >
                {item.status === "live" ? "Live" : "Ready"}
              </span>
            </div>
            <p className="mt-1 text-xs text-white/55">{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RepoList({ rows }: { rows: GitHubRepoRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/55">
        No repositories match this filter.
      </div>
    );
  }
  return (
    <ul className="mt-6 space-y-3">
      {rows.map((repo) => {
        const id = repo.id ?? `${repo.github_repo_id ?? ""}-${repo.full_name ?? ""}`;
        return (
          <li
            key={id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-basil-400/30"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={repo.html_url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-white hover:text-basil-200"
                  >
                    {repo.full_name ?? repo.name ?? "(unnamed)"}
                  </a>
                  {repo.is_private ? (
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amber-200">
                      Private
                    </span>
                  ) : (
                    <span className="rounded-full border border-basil-400/30 bg-basil-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-basil-200">
                      Public
                    </span>
                  )}
                  {repo.is_archived ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
                      Archived
                    </span>
                  ) : null}
                  {repo.is_fork ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
                      Fork
                    </span>
                  ) : null}
                </div>
                {repo.description ? (
                  <p className="mt-1 text-xs text-white/55">{repo.description}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.18em] text-white/45">
                  <span>{repo.language ?? "—"}</span>
                  <span>★ {repo.stargazers_count ?? 0}</span>
                  <span>default · {repo.default_branch ?? "main"}</span>
                  {repo.pushed_at ? (
                    <span>updated {relativeTime(repo.pushed_at)}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={repo.html_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/65 transition-colors hover:border-basil-400/40 hover:text-white"
                >
                  Open on GitHub
                </a>
                <button
                  type="button"
                  disabled
                  title="Repository import lands once project provisioning is wired."
                  className="rounded-full border border-basil-400/30 bg-basil-500/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-basil-200 opacity-60"
                >
                  Import (soon)
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyRepoState({
  onConnect,
  busy,
}: {
  onConnect: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <p className="text-sm font-medium text-white">
        Connect GitHub to see your repositories
      </p>
      <p className="mt-1 text-xs text-white/55">
        Authorization runs server-side. Your access token never touches the
        browser.
      </p>
      <button
        type="button"
        onClick={onConnect}
        disabled={busy}
        className="mt-4 rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-400/20 disabled:opacity-40"
      >
        {busy ? "Redirecting…" : "Authorize GitHub"}
      </button>
    </div>
  );
}

function PendingSyncState({ onSync, busy }: { onSync: () => void; busy: boolean }) {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
      <p className="text-sm font-medium text-white">No repositories synced yet</p>
      <p className="mt-1 text-xs text-white/55">
        Click sync to fetch the repositories you can install.
      </p>
      <button
        type="button"
        onClick={onSync}
        disabled={busy}
        className="mt-4 rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-400/20 disabled:opacity-40"
      >
        {busy ? "Syncing…" : "Sync repositories"}
      </button>
    </div>
  );
}

function FuturesGrid() {
  const items: { title: string; body: string }[] = [
    {
      title: "Pull request previews",
      body: "Spin up an isolated GTLNAV environment per PR with a unique URL.",
    },
    {
      title: "Branch protection signals",
      body: "Surface required checks + status posting into the GitHub UI.",
    },
    {
      title: "Org-level controls",
      body: "Map a GitHub organization to a GTLNAV team workspace with shared scopes.",
    },
    {
      title: "Token rotation",
      body: "Rotate AES-GCM envelopes via GTLNAV_TOKEN_ENCRYPTION_KEY rollover.",
    },
  ];
  return (
    <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.title}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-basil-400/30"
        >
          <p className="text-sm font-semibold text-white">{item.title}</p>
          <p className="mt-1 text-xs text-white/55">{item.body}</p>
          <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-basil-200/70">
            roadmap
          </p>
        </div>
      ))}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-white/40">{hint}</p> : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <dt className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/40">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-white/85">{value}</dd>
    </div>
  );
}

function SchemaSetupPanel() {
  const sql = `-- GTLNAV — Phase 4G GitHub OAuth tables
create table if not exists public.github_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  github_user_id bigint,
  github_login text,
  github_user_type text,
  display_name text,
  email text,
  avatar_url text,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  token_scope text,
  token_type text default 'bearer',
  expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  status text not null default 'connected',
  connected_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  github_account_id uuid references public.github_accounts (id) on delete cascade,
  github_repo_id bigint not null unique,
  full_name text,
  name text,
  owner_login text,
  owner_type text,
  html_url text,
  clone_url text,
  default_branch text,
  is_private boolean default false,
  is_archived boolean default false,
  is_fork boolean default false,
  description text,
  language text,
  stargazers_count integer default 0,
  pushed_at timestamptz,
  synced_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists github_accounts_user_idx
  on public.github_accounts (user_id);
create index if not exists github_repos_user_idx
  on public.github_repositories (user_id);
create index if not exists github_repos_account_idx
  on public.github_repositories (github_account_id);

-- Row Level Security
alter table public.github_accounts enable row level security;
alter table public.github_repositories enable row level security;

drop policy if exists "github_accounts owner select" on public.github_accounts;
drop policy if exists "github_accounts owner insert" on public.github_accounts;
drop policy if exists "github_accounts owner update" on public.github_accounts;
drop policy if exists "github_accounts owner delete" on public.github_accounts;
create policy "github_accounts owner select"
  on public.github_accounts for select using (auth.uid() = user_id);
create policy "github_accounts owner insert"
  on public.github_accounts for insert with check (auth.uid() = user_id);
create policy "github_accounts owner update"
  on public.github_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "github_accounts owner delete"
  on public.github_accounts for delete using (auth.uid() = user_id);

drop policy if exists "github_repositories owner select" on public.github_repositories;
drop policy if exists "github_repositories owner insert" on public.github_repositories;
drop policy if exists "github_repositories owner update" on public.github_repositories;
drop policy if exists "github_repositories owner delete" on public.github_repositories;
create policy "github_repositories owner select"
  on public.github_repositories for select using (auth.uid() = user_id);
create policy "github_repositories owner insert"
  on public.github_repositories for insert with check (auth.uid() = user_id);
create policy "github_repositories owner update"
  on public.github_repositories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "github_repositories owner delete"
  on public.github_repositories for delete using (auth.uid() = user_id);`;

  return (
    <section className="relative mt-8 overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-amber-200">
        // setup required
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">
        Run the GitHub OAuth schema in Supabase
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-white/55">
        These tables hold encrypted access tokens and synced repository
        metadata. RLS policies restrict every row to its owning user.
      </p>
      <pre className="mt-4 max-h-80 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-[11px] leading-relaxed text-white/80">
        {sql}
      </pre>
      <p className="mt-3 text-xs text-white/50">
        Also configure these environment variables on your server: {" "}
        <code className="rounded bg-black/60 px-1.5 py-0.5 text-white/80">
          GITHUB_OAUTH_CLIENT_ID
        </code>
        ,{" "}
        <code className="rounded bg-black/60 px-1.5 py-0.5 text-white/80">
          GITHUB_OAUTH_CLIENT_SECRET
        </code>
        ,{" "}
        <code className="rounded bg-black/60 px-1.5 py-0.5 text-white/80">
          GITHUB_OAUTH_REDIRECT_URI
        </code>
        , and {" "}
        <code className="rounded bg-black/60 px-1.5 py-0.5 text-white/80">
          GTLNAV_TOKEN_ENCRYPTION_KEY
        </code>
        .
      </p>
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

function isMissingTable(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("could not find the table") ||
    lower.includes("schema cache")
  );
}
