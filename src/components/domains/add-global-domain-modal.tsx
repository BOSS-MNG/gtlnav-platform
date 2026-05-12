"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/src/lib/supabase";
import {
  DEFAULT_DNS_TARGET,
  DNS_PROVIDERS,
  dnsRecordHost,
  getDnsProvider,
  isApexDomain,
  type DnsProviderValue,
} from "@/src/lib/dns-providers";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function isValidDomain(value: string) {
  if (!value) return false;
  return /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

export type ProjectOption = {
  id: string;
  name?: string | null;
  slug?: string | null;
};

type AddGlobalDomainModalProps = {
  open: boolean;
  userId: string;
  projects: ProjectOption[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreated: () => void;
};

export function AddGlobalDomainModal({
  open,
  userId,
  projects,
  defaultProjectId,
  onClose,
  onCreated,
}: AddGlobalDomainModalProps) {
  const [domain, setDomain] = useState("");
  const [projectId, setProjectId] = useState<string>(
    defaultProjectId ?? projects[0]?.id ?? "",
  );
  const [provider, setProvider] = useState<DnsProviderValue>("squarespace");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDomain("");
      setSubmitting(false);
      setError(null);
      setProvider("squarespace");
      setProjectId(defaultProjectId ?? projects[0]?.id ?? "");
    } else {
      setProjectId((current) =>
        current && projects.some((p) => p.id === current)
          ? current
          : (defaultProjectId ?? projects[0]?.id ?? ""),
      );
    }
  }, [open, defaultProjectId, projects]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const previewHost = useMemo(() => {
    const trimmed = normalizeDomain(domain);
    if (!trimmed) return "—";
    return dnsRecordHost(trimmed);
  }, [domain]);

  const apexWarning = useMemo(() => {
    const trimmed = normalizeDomain(domain);
    return trimmed && isApexDomain(trimmed);
  }, [domain]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!projectId) {
      setError("Pick a project to attach this domain to.");
      return;
    }
    const finalDomain = normalizeDomain(domain);
    if (!isValidDomain(finalDomain)) {
      setError("Enter a valid domain like example.com or app.example.com.");
      return;
    }

    setSubmitting(true);
    try {
      const fullPayload = {
        user_id: userId,
        project_id: projectId,
        domain: finalDomain,
        status: "pending",
        ssl_status: "pending",
        dns_target: DEFAULT_DNS_TARGET,
        dns_provider: provider,
      };

      let { error: insertError } = await supabase
        .from("domains")
        .insert(fullPayload);

      if (insertError) {
        const fallback = await supabase.from("domains").insert({
          user_id: userId,
          project_id: projectId,
          domain: finalDomain,
          status: "pending",
          ssl_status: "pending",
          dns_target: DEFAULT_DNS_TARGET,
        });
        insertError = fallback.error;
      }

      if (insertError) {
        setError(insertError.message);
        return;
      }

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add domain.");
    } finally {
      setSubmitting(false);
    }
  }

  const providerInfo = getDnsProvider(provider);

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
                // attach-domain
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                Add domain
              </h2>
              <p className="mt-1 text-sm text-white/55">
                Connect a custom domain to one of your GTLNAV projects.
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

          {projects.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              You need at least one project before attaching a domain.{" "}
              <a
                href="/dashboard"
                className="text-basil-300 underline-offset-4 hover:underline"
              >
                Create one →
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error ? (
                <div
                  role="alert"
                  className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {error}
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="global-domain-project"
                  className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                >
                  Project
                </label>
                <select
                  id="global-domain-project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className={inputClass}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-black">
                      {p.name ?? p.slug ?? p.id}
                      {p.slug ? ` · /${p.slug}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
                <div>
                  <label
                    htmlFor="global-domain-input"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                  >
                    Domain
                  </label>
                  <input
                    id="global-domain-input"
                    type="text"
                    required
                    inputMode="url"
                    autoComplete="off"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="app.example.com"
                    className={`${inputClass} font-mono`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="global-domain-provider"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-basil-300/90"
                  >
                    Registrar
                  </label>
                  <select
                    id="global-domain-provider"
                    value={provider}
                    onChange={(e) =>
                      setProvider(e.target.value as DnsProviderValue)
                    }
                    className={inputClass}
                  >
                    {DNS_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value} className="bg-black">
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-white/55">
                <RowKV k="record" v="CNAME" />
                <RowKV k="host" v={previewHost} />
                <RowKV k="target" v={DEFAULT_DNS_TARGET} />
                <RowKV k="ttl" v={providerInfo?.ttlHint ?? "Auto"} />
                <RowKV k="status" v="pending" />
              </div>

              {apexWarning ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                  Root domains like{" "}
                  <span className="font-mono text-amber-50">
                    {normalizeDomain(domain)}
                  </span>{" "}
                  require A or ALIAS records later. GTLNAV Beta supports
                  subdomains first — try adding{" "}
                  <span className="font-mono text-amber-50">
                    app.{normalizeDomain(domain)}
                  </span>{" "}
                  or{" "}
                  <span className="font-mono text-amber-50">
                    www.{normalizeDomain(domain)}
                  </span>
                  .
                </div>
              ) : null}

              <div className="mt-2 flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Adding…" : "Add domain"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function RowKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between first:mt-0">
      <span className="text-basil-300/80">{k}</span>
      <span className="truncate pl-3 text-right text-white/85">{v}</span>
    </div>
  );
}
