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
import { absoluteTime, relativeTime } from "@/src/lib/dashboard-format";

type TokenType = "personal" | "deployment" | "cli";

const TOKEN_TYPES: { value: TokenType; label: string; hint: string }[] = [
  {
    value: "personal",
    label: "Personal access",
    hint: "For your own scripts and integrations.",
  },
  {
    value: "deployment",
    label: "Deployment",
    hint: "Trigger builds and deploys from CI / external systems.",
  },
  {
    value: "cli",
    label: "CLI",
    hint: "Sign in to the GTLNAV CLI on a workstation.",
  },
];

const SCOPES = [
  {
    value: "projects:read",
    label: "projects:read",
    hint: "List and read project metadata",
  },
  {
    value: "projects:write",
    label: "projects:write",
    hint: "Create or update projects",
  },
  {
    value: "deployments:trigger",
    label: "deployments:trigger",
    hint: "Queue and run deployments",
  },
  {
    value: "domains:write",
    label: "domains:write",
    hint: "Attach, verify, or remove domains",
  },
  { value: "logs:read", label: "logs:read", hint: "Read infrastructure logs" },
  {
    value: "env:write",
    label: "env:write",
    hint: "Manage environment variables",
  },
] as const;

type ScopeValue = (typeof SCOPES)[number]["value"];

const DEFAULT_SCOPES_BY_TYPE: Record<TokenType, ScopeValue[]> = {
  personal: ["projects:read", "deployments:trigger", "logs:read"],
  deployment: ["projects:read", "deployments:trigger"],
  cli: [
    "projects:read",
    "projects:write",
    "deployments:trigger",
    "domains:write",
    "logs:read",
    "env:write",
  ],
};

const CLI_COMMANDS: { id: string; cmd: string; desc: string }[] = [
  { id: "install", cmd: "npm install -g gtlnav", desc: "Install the CLI globally." },
  { id: "login", cmd: "gtlnav login", desc: "Browser-based login." },
  { id: "init", cmd: "gtlnav init", desc: "Link the current folder to a project." },
  { id: "deploy", cmd: "gtlnav deploy", desc: "Build and deploy from this directory." },
  { id: "logs", cmd: "gtlnav logs", desc: "Stream live deployment + infrastructure logs." },
  { id: "env-pull", cmd: "gtlnav env pull", desc: "Sync env vars to .env.local." },
  { id: "domains", cmd: "gtlnav domains list", desc: "List domains for the linked project." },
];

type ApiKeyRow = {
  id: string;
  user_id?: string | null;
  name?: string | null;
  key_prefix?: string | null;
  key_hash?: string | null;
  token_type?: string | null;
  scopes?: string[] | null;
  created_at?: string | null;
  last_used_at?: string | null;
  revoked_at?: string | null;
  [key: string]: unknown;
};

type LoadResult = {
  keys: ApiKeyRow[];
  tableAvailable: boolean;
  errors: string[];
};

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

function isMissingTableError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("not found")
  );
}

async function loadKeys(userId: string): Promise<LoadResult> {
  const errors: string[] = [];
  const res = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (res.error) {
    if (isMissingTableError(res.error.message)) {
      return { keys: [], tableAvailable: false, errors: [] };
    }
    errors.push(`api_keys: ${res.error.message}`);
    return { keys: [], tableAvailable: true, errors };
  }
  return {
    keys: (res.data ?? []) as ApiKeyRow[],
    tableAvailable: true,
    errors,
  };
}

function generateKey(tokenType: TokenType) {
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
  const env = "live";
  const typeTag =
    tokenType === "deployment" ? "dep" : tokenType === "cli" ? "cli" : "pat";
  const fullKey = `gtlnav_${env}_${typeTag}_${suffix}`;
  const prefix = fullKey.slice(0, fullKey.indexOf(typeTag) + typeTag.length + 5); // gtlnav_live_xxx_xxxxx
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
  eventType: string,
  message: string,
  severity: string,
  metadata?: Record<string, unknown>,
) {
  const full = {
    user_id: userId,
    project_id: null,
    event_type: eventType,
    level: severity,
    severity,
    message,
    source: "developer_settings",
    metadata: metadata ?? {},
  };
  const { error } = await supabase.from("infrastructure_logs").insert(full);
  if (!error) return;
  await supabase.from("infrastructure_logs").insert({
    user_id: userId,
    project_id: null,
    event_type: eventType,
    severity,
    message,
  });
}

export function AccountSettingsClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<"keys" | "cli">("keys");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tableAvailable, setTableAvailable] = useState(true);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<{
    name: string;
    full: string;
  } | null>(null);
  const [revealCopied, setRevealCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

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
        const result = await loadKeys(userId);
        setKeys(result.keys);
        setTableAvailable(result.tableAvailable);
        setLoadErrors(result.errors);
      } catch (e) {
        setLoadErrors([
          e instanceof Error ? e.message : "Failed to load API keys.",
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

  async function handleCreate(input: {
    name: string;
    tokenType: TokenType;
    scopes: ScopeValue[];
  }) {
    const uid = session?.user?.id;
    if (!uid) return;
    const name = input.name.trim();
    if (!name) {
      flashToast("error", "Name your token so it's easy to revoke later.");
      return;
    }
    if (input.scopes.length === 0) {
      flashToast("error", "Select at least one scope.");
      return;
    }
    const { fullKey, prefix } = generateKey(input.tokenType);
    const keyHash = await fakeHash(fullKey);
    const now = new Date().toISOString();
    const payloadFull = {
      user_id: uid,
      name,
      key_prefix: prefix,
      key_hash: keyHash,
      token_type: input.tokenType,
      scopes: input.scopes,
      created_at: now,
      last_used_at: null,
      revoked_at: null,
    };
    let { error } = await supabase.from("api_keys").insert(payloadFull);
    if (error) {
      const fallback = await supabase.from("api_keys").insert({
        user_id: uid,
        name,
        key_prefix: prefix,
        key_hash: keyHash,
        token_type: input.tokenType,
        scopes: input.scopes,
      });
      error = fallback.error;
    }
    if (error) {
      if (isMissingTableError(error.message)) {
        setTableAvailable(false);
        flashToast(
          "error",
          "API keys table is missing. See setup instructions below.",
        );
        return;
      }
      flashToast("error", error.message);
      return;
    }
    await insertInfraLog(
      uid,
      "api_key_created",
      `API key ${name} created.`,
      "success",
      { token_type: input.tokenType, scopes: input.scopes, key_prefix: prefix },
    );
    setCreateOpen(false);
    setRevealKey({ name, full: fullKey });
    flashToast("success", "API key created. Copy it before closing.");
    void refresh(uid, "refresh");
  }

  async function handleRevoke() {
    const uid = session?.user?.id;
    if (!uid || !revokeTarget) return;
    setRevokeError(null);
    setRevokeBusy(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("api_keys")
        .update({ revoked_at: now })
        .eq("id", revokeTarget.id)
        .eq("user_id", uid);
      if (error) {
        setRevokeError(error.message);
        return;
      }
      await insertInfraLog(
        uid,
        "api_key_revoked",
        `API key ${revokeTarget.name ?? revokeTarget.id} revoked.`,
        "warning",
        {
          token_type: revokeTarget.token_type ?? null,
          scopes: revokeTarget.scopes ?? [],
          key_prefix: revokeTarget.key_prefix ?? null,
        },
      );
      flashToast("info", "Key revoked.");
      setRevokeTarget(null);
      void refresh(uid, "refresh");
    } finally {
      setRevokeBusy(false);
    }
  }

  async function copyText(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
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
        <DashboardSidebar activeKey="settings" userEmail={user.email} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // developer-settings
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                API keys & CLI
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-white/55">
                Provision tokens for the GTLNAV CLI, CI deployments, and
                personal scripts. Tokens grant scoped access to projects,
                deployments, domains, logs, and environment variables.
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
                active={tab === "keys"}
                onClick={() => setTab("keys")}
                label="API keys"
              />
              <TabButton
                active={tab === "cli"}
                onClick={() => setTab("cli")}
                label="CLI foundation"
              />
            </nav>

            <div className="min-w-0 flex-1 space-y-6">
              {tab === "keys" ? (
                <ApiKeysSection
                  loading={loading}
                  tableAvailable={tableAvailable}
                  keys={keys}
                  onCreateClick={() => setCreateOpen(true)}
                  onRevokeClick={(k) => {
                    setRevokeError(null);
                    setRevokeTarget(k);
                  }}
                  onCopyPrefix={(id, prefix) => void copyText(id, prefix)}
                  copiedId={copiedId}
                />
              ) : (
                <CliSection
                  copiedId={copiedId}
                  onCopy={(id, cmd) => void copyText(id, cmd)}
                  loginPrefix={
                    keys.find(
                      (k) =>
                        (k.token_type ?? "").toLowerCase() === "cli" &&
                        !k.revoked_at,
                    )?.key_prefix ?? null
                  }
                />
              )}
            </div>
          </div>
        </main>
      </div>

      <CreateKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => void handleCreate(input)}
      />

      <RevealKeyModal
        open={Boolean(revealKey)}
        keyName={revealKey?.name ?? ""}
        keyValue={revealKey?.full ?? ""}
        copied={revealCopied}
        onCopy={async () => {
          if (!revealKey) return;
          try {
            await navigator.clipboard.writeText(revealKey.full);
            setRevealCopied(true);
            window.setTimeout(() => setRevealCopied(false), 1500);
          } catch {
            flashToast("error", "Could not copy to clipboard.");
          }
        }}
        onClose={() => {
          setRevealKey(null);
          setRevealCopied(false);
        }}
      />

      <ConfirmModal
        open={Boolean(revokeTarget)}
        title="Revoke this API key?"
        description={`"${revokeTarget?.name ?? "Unnamed"}" will stop working immediately. The key remains in the audit trail.`}
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

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-2.5 text-left text-sm transition-all lg:w-full ${
        active
          ? "border-basil-400/50 bg-basil-500/15 text-basil-100"
          : "border-white/10 bg-white/[0.02] text-white/65 hover:border-basil-400/30 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function ApiKeysSection({
  loading,
  tableAvailable,
  keys,
  onCreateClick,
  onRevokeClick,
  onCopyPrefix,
  copiedId,
}: {
  loading: boolean;
  tableAvailable: boolean;
  keys: ApiKeyRow[];
  onCreateClick: () => void;
  onRevokeClick: (k: ApiKeyRow) => void;
  onCopyPrefix: (id: string, prefix: string) => void;
  copiedId: string | null;
}) {
  if (loading) {
    return <PanelSkeleton />;
  }
  if (!tableAvailable) {
    return <MissingTablePanel />;
  }
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            // tokens
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">API keys</h2>
          <p className="mt-1 max-w-xl text-sm text-white/55">
            Personal access, deployment, and CLI tokens. We only store the
            prefix and a hash — copy the full key when it&apos;s shown.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
        >
          ＋ Create API key
        </button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-black/40">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-white/40">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Prefix</th>
              <th className="px-4 py-3">Scopes</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Last used</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-white/45"
                >
                  No API keys yet. Create one to start using the CLI or trigger
                  deployments from CI.
                </td>
              </tr>
            ) : (
              keys.map((k) => {
                const revoked = Boolean(k.revoked_at);
                const tokenType = (k.token_type ?? "personal").toLowerCase();
                const scopes = Array.isArray(k.scopes) ? k.scopes : [];
                const prefix = k.key_prefix ?? "—";
                return (
                  <tr
                    key={k.id}
                    className={`border-b border-white/5 last:border-0 transition-colors ${
                      revoked ? "opacity-60" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-white">
                          {k.name ?? "Unnamed key"}
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
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/70">
                        {tokenType}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-basil-200/90">
                          {prefix}
                        </span>
                        <button
                          type="button"
                          onClick={() => onCopyPrefix(k.id, prefix)}
                          className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/55 hover:border-basil-400/40"
                        >
                          {copiedId === k.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {scopes.length === 0 ? (
                          <span className="text-xs text-white/40">—</span>
                        ) : (
                          scopes.slice(0, 4).map((s) => (
                            <span
                              key={String(s)}
                              className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-white/70"
                            >
                              {String(s)}
                            </span>
                          ))
                        )}
                        {scopes.length > 4 ? (
                          <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-white/55">
                            +{scopes.length - 4}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className="px-4 py-3 align-top text-xs text-white/55"
                      title={absoluteTime(k.created_at)}
                    >
                      {relativeTime(k.created_at)}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-white/55">
                      {k.last_used_at ? (
                        <span title={absoluteTime(k.last_used_at)}>
                          {relativeTime(k.last_used_at)}
                        </span>
                      ) : (
                        <span className="text-white/35">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {revoked ? (
                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                          Revoked {relativeTime(k.revoked_at)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRevokeClick(k)}
                          className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-red-200 transition-colors hover:bg-red-500/20"
                        >
                          Revoke
                        </button>
                      )}
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

function MissingTablePanel() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" />
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-amber-200/80">
        // setup-required
      </p>
      <h2 className="mt-2 text-lg font-semibold text-white">
        API keys table is missing
      </h2>
      <p className="mt-1 max-w-xl text-sm text-white/60">
        Run this SQL in Supabase to enable the developer settings page. We
        only store metadata and a hash of the key — never the raw token.
      </p>
      <pre className="mt-5 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 font-mono text-[11px] text-basil-200/90">
{`create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  token_type text not null default 'personal',
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.api_keys enable row level security;

create policy "api_keys are user-owned"
  on public.api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);`}
      </pre>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-xl">
      <div className="h-5 w-40 animate-pulse rounded-md bg-white/[0.06]" />
      <div className="mt-4 h-32 animate-pulse rounded-2xl bg-white/[0.04]" />
    </section>
  );
}

function CliSection({
  copiedId,
  onCopy,
  loginPrefix,
}: {
  copiedId: string | null;
  onCopy: (id: string, value: string) => void;
  loginPrefix: string | null;
}) {
  const tokenLogin = `gtlnav login --token ${loginPrefix ?? "gtlnav_live_cli_xxxxxxxxxxxx"}`;
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
          // gtlnav-cli
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          Install &amp; common commands
        </h2>
        <p className="mt-1 max-w-xl text-sm text-white/55">
          The GTLNAV CLI lets you deploy, stream logs, and sync env vars from
          your terminal. Each command supports{" "}
          <code className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-basil-200/90">
            --token
          </code>{" "}
          for non-interactive auth.
        </p>
        <div className="mt-6 grid gap-3">
          {CLI_COMMANDS.map((row) => (
            <CommandRow
              key={row.id}
              id={row.id}
              cmd={row.cmd}
              desc={row.desc}
              copied={copiedId === row.id}
              onCopy={() => onCopy(row.id, row.cmd)}
            />
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden rounded-3xl border border-basil-400/20 bg-gradient-to-br from-basil-500/[0.06] via-white/[0.02] to-transparent p-6 backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent" />
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
          // headless-auth
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          Use this token with the GTLNAV CLI
        </h2>
        <p className="mt-1 max-w-xl text-sm text-white/55">
          Generate a CLI token in the API Keys tab, then sign in headlessly:
        </p>
        <div className="mt-5">
          <CommandRow
            id="cli-login"
            cmd={tokenLogin}
            desc={
              loginPrefix
                ? `Detected active CLI token starting with ${loginPrefix}.`
                : "No active CLI token detected — create one to fill this command in."
            }
            copied={copiedId === "cli-login"}
            onCopy={() => onCopy("cli-login", tokenLogin)}
            highlight
          />
        </div>
        <p className="mt-3 text-[11px] text-white/40">
          Tokens are scoped per-key. Rotate or revoke them anytime — revoking
          immediately disables the CLI session.
        </p>
      </section>
    </div>
  );
}

function CommandRow({
  id,
  cmd,
  desc,
  copied,
  onCopy,
  highlight,
}: {
  id: string;
  cmd: string;
  desc: string;
  copied: boolean;
  onCopy: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-2xl border bg-black/45 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
        highlight
          ? "border-basil-400/40 shadow-[0_0_24px_-12px_rgba(111,232,154,0.6)]"
          : "border-white/10"
      }`}
      data-cmd-id={id}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-basil-200/80">
          <span className="font-mono text-[11px] text-white/30">$</span>
          <code className="block truncate font-mono text-sm text-white">
            {cmd}
          </code>
        </div>
        <p className="mt-1 text-xs text-white/45">{desc}</p>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={`shrink-0 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors ${
          copied
            ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
            : "border-white/10 text-white/65 hover:border-basil-400/40 hover:text-white"
        }`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function CreateKeyModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    tokenType: TokenType;
    scopes: ScopeValue[];
  }) => void;
}) {
  const [name, setName] = useState("");
  const [tokenType, setTokenType] = useState<TokenType>("personal");
  const [scopes, setScopes] = useState<ScopeValue[]>(
    DEFAULT_SCOPES_BY_TYPE.personal,
  );

  useEffect(() => {
    if (!open) {
      setName("");
      setTokenType("personal");
      setScopes(DEFAULT_SCOPES_BY_TYPE.personal);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function changeType(next: TokenType) {
    setTokenType(next);
    setScopes(DEFAULT_SCOPES_BY_TYPE[next]);
  }

  function toggleScope(value: ScopeValue) {
    setScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ name: name.trim(), tokenType, scopes });
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
      <div className="relative w-full max-w-lg">
        <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-80 blur-md" />
        <div className="relative max-h-[88vh] overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-7 shadow-[0_0_60px_-15px_rgba(111,232,154,0.5)] backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent" />

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                // create-key
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Create API key
              </h2>
              <p className="mt-1 text-sm text-white/55">
                Choose a token type and the minimum scopes needed.
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

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                Name
              </label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CI · production deploys"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                Token type
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                {TOKEN_TYPES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => changeType(opt.value)}
                    className={`rounded-2xl border px-3 py-3 text-left text-xs transition-all ${
                      tokenType === opt.value
                        ? "border-basil-400/50 bg-basil-500/15 text-basil-50"
                        : "border-white/10 bg-white/[0.02] text-white/65 hover:border-basil-400/30"
                    }`}
                  >
                    <p className="text-sm font-medium text-white">
                      {opt.label}
                    </p>
                    <p className="mt-1 text-[11px] text-white/55">{opt.hint}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90">
                Scopes
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((scope) => {
                  const active = scopes.includes(scope.value);
                  return (
                    <button
                      key={scope.value}
                      type="button"
                      onClick={() => toggleScope(scope.value)}
                      className={`flex items-start gap-2 rounded-2xl border px-3 py-2.5 text-left transition-all ${
                        active
                          ? "border-basil-400/50 bg-basil-500/15"
                          : "border-white/10 bg-white/[0.02] hover:border-basil-400/30"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                          active
                            ? "border-basil-400/60 bg-basil-500/20 text-basil-100"
                            : "border-white/20 bg-black/40 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-basil-100">
                          {scope.label}
                        </span>
                        <span className="block text-[11px] text-white/55">
                          {scope.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
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
                className="rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
              >
                Generate key
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function RevealKeyModal({
  open,
  keyName,
  keyValue,
  copied,
  onCopy,
  onClose,
}: {
  open: boolean;
  keyName: string;
  keyValue: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl">
        <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/50 via-basil-500/10 to-transparent opacity-80 blur-md" />
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-7 shadow-[0_0_60px_-15px_rgba(111,232,154,0.6)] backdrop-blur-2xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/70 to-transparent" />
          <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/90">
            // copy-now
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            Your new API key for &ldquo;{keyName}&rdquo;
          </h2>
          <p className="mt-2 text-sm text-amber-200/85">
            This is the only time the full key will be shown. Copy it and store
            it somewhere safe.
          </p>

          <div className="mt-5 rounded-2xl border border-basil-400/40 bg-black/60 p-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-basil-300/80">
              gtlnav api key
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="block flex-1 break-all font-mono text-sm text-basil-100">
                {keyValue}
              </code>
              <button
                type="button"
                onClick={onCopy}
                className="shrink-0 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-1.5 text-xs font-semibold text-black"
              >
                {copied ? "Copied" : "Copy key"}
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/60">
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
              CLI quickstart
            </p>
            <code className="mt-2 block break-all font-mono text-sm text-white">
              gtlnav login --token {keyValue}
            </code>
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

export default AccountSettingsClient;
