/**
 * GTLNAV — server-side domain + DNS verification helpers.
 *
 * Server-only: throws if imported from a 'use client' component.
 *
 * What lives here:
 *   - `loadOwnedDomain` — schema-tolerant fetch of a `domains` row scoped to
 *     the calling user.
 *   - `runDnsCheck` — uses Node's resolver (`node:dns/promises`) to look up
 *     the user's domain and report back structured CNAME / A / AAAA
 *     records, plus a boolean "matched" flag against the expected target.
 *   - `markDomainVerified` / `markSslPending` / `markSslIssued` — schema-
 *     tolerant `domains` row updates.
 *   - `buildDnsInstructions` — structured registrar instructions (host,
 *     type, target, ttl, narrative steps from `dns-providers.ts`).
 *
 * The library does NOT auto-revert `domains.status`. A failed DNS check
 * leaves the row's status alone — operators choose when to demote.
 */

import { Resolver } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DNS_TARGET,
  dnsRecordHost,
  getDnsProvider,
  isApexDomain,
  type DnsProvider,
} from "./dns-providers";
import { isMissingColumn, isMissingTable } from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-domains.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type DomainRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  domain: string;
  status: string | null;
  ssl_status: string | null;
  dns_target: string | null;
  dns_provider: string | null;
  created_at: string | null;
  updated_at: string | null;
  verified_at?: string | null;
  ssl_requested_at?: string | null;
};

export type DnsRecord = {
  type: "CNAME" | "A" | "AAAA";
  value: string;
};

export type DnsCheckError = {
  type: "CNAME" | "A" | "AAAA" | "TARGET_A";
  code: string;
  message: string;
};

export type DnsCheckOutcome = {
  domain: string;
  expected_target: string;
  matched: boolean;
  match_kind: "cname" | "a_record" | "none";
  is_apex: boolean;
  found_records: DnsRecord[];
  expected_target_a: string[];
  errors: DnsCheckError[];
  checked_at: string;
};

const DOMAIN_SELECT_FULL =
  "id, user_id, project_id, domain, status, ssl_status, dns_target, dns_provider, created_at, updated_at, verified_at, ssl_requested_at";

const DOMAIN_SELECT_MINIMAL =
  "id, user_id, project_id, domain, status, ssl_status, dns_target, dns_provider, created_at, updated_at";

// ---------------------------------------------------------------------------
//  Domain loader
// ---------------------------------------------------------------------------

export type LoadDomainResult =
  | { ok: true; domain: DomainRow; usedMinimalSchema: boolean }
  | { ok: false; status: number; error: string; message: string };

export async function loadOwnedDomain(
  client: SupabaseClient,
  args: { domainId: string; userId: string },
): Promise<LoadDomainResult> {
  if (!args.domainId) {
    return {
      ok: false,
      status: 400,
      error: "missing_domain_id",
      message: "domain_id is required.",
    };
  }

  let usedMinimal = false;
  let res = await client
    .from("domains")
    .select(DOMAIN_SELECT_FULL)
    .eq("id", args.domainId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (res.error && isMissingColumn(res.error.message)) {
    usedMinimal = true;
    res = await client
      .from("domains")
      .select(DOMAIN_SELECT_MINIMAL)
      .eq("id", args.domainId)
      .eq("user_id", args.userId)
      .maybeSingle();
  }

  if (res.error) {
    if (isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "domains_table_missing",
        message: "domains table is not provisioned.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: "domains_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    return {
      ok: false,
      status: 404,
      error: "domain_not_found",
      message: "Domain not found or not owned by caller.",
    };
  }

  const row = res.data as Record<string, unknown>;
  const domain: DomainRow = {
    id: String(row.id),
    user_id: String(row.user_id),
    project_id: row.project_id != null ? String(row.project_id) : null,
    domain: (row.domain != null ? String(row.domain) : "").trim(),
    status: row.status != null ? String(row.status) : null,
    ssl_status: row.ssl_status != null ? String(row.ssl_status) : null,
    dns_target: row.dns_target != null ? String(row.dns_target) : null,
    dns_provider: row.dns_provider != null ? String(row.dns_provider) : null,
    created_at: row.created_at != null ? String(row.created_at) : null,
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
    verified_at: row.verified_at != null ? String(row.verified_at) : null,
    ssl_requested_at:
      row.ssl_requested_at != null ? String(row.ssl_requested_at) : null,
  };
  return { ok: true, domain, usedMinimalSchema: usedMinimal };
}

// ---------------------------------------------------------------------------
//  Expected DNS target
// ---------------------------------------------------------------------------

export function getExpectedDnsTarget(domain: DomainRow): string {
  const stored = (domain.dns_target ?? "").trim().replace(/\.$/, "");
  return stored.length > 0 ? stored : DEFAULT_DNS_TARGET.replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
//  DNS resolution
// ---------------------------------------------------------------------------

const DEFAULT_DNS_TIMEOUT_MS = 5000;
const DEFAULT_DNS_TRIES = 2;

function makeResolver(): Resolver {
  return new Resolver({ timeout: DEFAULT_DNS_TIMEOUT_MS, tries: DEFAULT_DNS_TRIES });
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function isValidDomainName(value: string): boolean {
  if (!value || value.length > 253) return false;
  // Each label: 1-63 chars, letters/digits/hyphen, no leading/trailing hyphen
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

export async function runDnsCheck(
  domainName: string,
  expectedTargetRaw: string,
): Promise<DnsCheckOutcome> {
  const checkedAt = new Date().toISOString();
  const errors: DnsCheckError[] = [];
  const records: DnsRecord[] = [];

  const cleanedDomain = normalizeHostname(domainName);
  const expected = normalizeHostname(expectedTargetRaw);

  const baseOutcome: DnsCheckOutcome = {
    domain: cleanedDomain,
    expected_target: expected,
    matched: false,
    match_kind: "none",
    is_apex: isApexDomain(cleanedDomain),
    found_records: records,
    expected_target_a: [],
    errors,
    checked_at: checkedAt,
  };

  if (!cleanedDomain || !isValidDomainName(cleanedDomain)) {
    errors.push({
      type: "CNAME",
      code: "INVALID_DOMAIN",
      message: `"${domainName}" is not a valid domain name.`,
    });
    return baseOutcome;
  }

  const resolver = makeResolver();

  // 1. CNAME (preferred for subdomains).
  let cnameTargets: string[] = [];
  try {
    const out = await resolver.resolveCname(cleanedDomain);
    cnameTargets = out.map(normalizeHostname).filter(Boolean);
    for (const t of cnameTargets) records.push({ type: "CNAME", value: t });
  } catch (err) {
    errors.push(toDnsErr("CNAME", err));
  }

  if (cnameTargets.some((t) => t === expected)) {
    baseOutcome.matched = true;
    baseOutcome.match_kind = "cname";
    return baseOutcome;
  }

  // 2. A records (apex / fallback). Compare against expected target's A set.
  let aRecords: string[] = [];
  try {
    aRecords = await resolver.resolve4(cleanedDomain);
    for (const ip of aRecords) records.push({ type: "A", value: ip });
  } catch (err) {
    errors.push(toDnsErr("A", err));
  }

  let aaaaRecords: string[] = [];
  try {
    aaaaRecords = await resolver.resolve6(cleanedDomain);
    for (const ip of aaaaRecords) records.push({ type: "AAAA", value: ip });
  } catch (err) {
    // AAAA absence is not a hard error — many domains skip IPv6.
    const e = toDnsErr("AAAA", err);
    if (e.code !== "ENODATA" && e.code !== "ENOTFOUND") errors.push(e);
  }

  let expectedA: string[] = [];
  try {
    expectedA = await resolver.resolve4(expected);
    baseOutcome.expected_target_a = expectedA;
  } catch (err) {
    errors.push(toDnsErr("TARGET_A", err));
  }

  if (
    expectedA.length > 0 &&
    aRecords.length > 0 &&
    aRecords.some((ip) => expectedA.includes(ip))
  ) {
    baseOutcome.matched = true;
    baseOutcome.match_kind = "a_record";
  }

  return baseOutcome;
}

function toDnsErr(type: DnsCheckError["type"], err: unknown): DnsCheckError {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as NodeJS.ErrnoException;
    return {
      type,
      code: typeof e.code === "string" ? e.code : "EUNKNOWN",
      message: e.message ?? String(e),
    };
  }
  if (err instanceof Error) {
    return { type, code: "EUNKNOWN", message: err.message };
  }
  return { type, code: "EUNKNOWN", message: String(err) };
}

// ---------------------------------------------------------------------------
//  Status updates (schema-tolerant)
// ---------------------------------------------------------------------------

export type StatusUpdateResult =
  | { ok: true; domain: DomainRow }
  | { ok: false; status: number; error: string; message: string };

async function updateDomainRow(
  client: SupabaseClient,
  args: {
    domainId: string;
    userId: string;
    full: Record<string, unknown>;
    minimal: Record<string, unknown>;
  },
): Promise<StatusUpdateResult> {
  let res = await client
    .from("domains")
    .update(args.full)
    .eq("id", args.domainId)
    .eq("user_id", args.userId)
    .select(DOMAIN_SELECT_FULL)
    .maybeSingle();

  if (res.error && isMissingColumn(res.error.message)) {
    res = await client
      .from("domains")
      .update(args.minimal)
      .eq("id", args.domainId)
      .eq("user_id", args.userId)
      .select(DOMAIN_SELECT_MINIMAL)
      .maybeSingle();
  }

  if (res.error || !res.data) {
    if (res.error && isMissingTable(res.error.message)) {
      return {
        ok: false,
        status: 503,
        error: "domains_table_missing",
        message: "domains table is not provisioned.",
      };
    }
    return {
      ok: false,
      status: 500,
      error: "domains_update_failed",
      message: res.error?.message ?? "Failed to update domains row.",
    };
  }
  const row = res.data as Record<string, unknown>;
  return {
    ok: true,
    domain: {
      id: String(row.id),
      user_id: String(row.user_id),
      project_id: row.project_id != null ? String(row.project_id) : null,
      domain: row.domain != null ? String(row.domain) : "",
      status: row.status != null ? String(row.status) : null,
      ssl_status: row.ssl_status != null ? String(row.ssl_status) : null,
      dns_target: row.dns_target != null ? String(row.dns_target) : null,
      dns_provider: row.dns_provider != null ? String(row.dns_provider) : null,
      created_at: row.created_at != null ? String(row.created_at) : null,
      updated_at: row.updated_at != null ? String(row.updated_at) : null,
      verified_at: row.verified_at != null ? String(row.verified_at) : null,
      ssl_requested_at:
        row.ssl_requested_at != null ? String(row.ssl_requested_at) : null,
    },
  };
}

export async function markDomainVerified(
  client: SupabaseClient,
  args: { domainId: string; userId: string },
): Promise<StatusUpdateResult> {
  const now = new Date().toISOString();
  return updateDomainRow(client, {
    ...args,
    full: { status: "verified", verified_at: now, updated_at: now },
    minimal: { status: "verified", updated_at: now },
  });
}

/**
 * Mark SSL as pending. Accepts an explicit pending state because the
 * dashboard distinguishes between "waiting on DNS" (`pending_dns` / legacy
 * `pending`) and "DNS verified, waiting on ACME" (`pending_ssl`).
 *
 * The proxy worker is the only thing that should flip `ssl_status` to
 * `issued` — never the dashboard, never this control-plane API.
 */
export async function markSslPending(
  client: SupabaseClient,
  args: {
    domainId: string;
    userId: string;
    pendingState?: "pending" | "pending_dns" | "pending_ssl";
  },
): Promise<StatusUpdateResult> {
  const now = new Date().toISOString();
  const state = args.pendingState ?? "pending";
  return updateDomainRow(client, {
    domainId: args.domainId,
    userId: args.userId,
    full: { ssl_status: state, ssl_requested_at: now, updated_at: now },
    minimal: { ssl_status: state, updated_at: now },
  });
}

/**
 * @deprecated The dashboard / control plane MUST NOT mark SSL as issued.
 * Only the proxy worker (Caddy + ACME callback) should advance to `issued`.
 * Retained for back-compat with any out-of-tree scripts; new code must call
 * the proxy worker instead.
 */
export async function markSslIssued(
  client: SupabaseClient,
  args: { domainId: string; userId: string },
): Promise<StatusUpdateResult> {
  const now = new Date().toISOString();
  return updateDomainRow(client, {
    ...args,
    full: { ssl_status: "issued", ssl_issued_at: now, updated_at: now },
    minimal: { ssl_status: "issued", updated_at: now },
  });
}

// ---------------------------------------------------------------------------
//  Instructions
// ---------------------------------------------------------------------------

export type DnsInstructions = {
  type: "CNAME" | "A";
  host: string;
  target: string;
  ttl_hint: string;
  registrar: string;
  steps: string[];
  notes: string[];
};

export function buildDnsInstructions(
  domain: DomainRow,
  expectedTarget: string,
): DnsInstructions {
  const provider: DnsProvider | null = getDnsProvider(domain.dns_provider);
  const apex = isApexDomain(domain.domain);
  const recordType = apex ? "A" : "CNAME";
  const host = apex ? "@" : dnsRecordHost(domain.domain);
  const notes: string[] = [];
  if (apex) {
    notes.push(
      `${domain.domain} is an apex domain — most registrars do NOT allow CNAME at "@". Either use ALIAS/ANAME for ${expectedTarget}, or point an A record at one of the IPs that ${expectedTarget} currently resolves to.`,
    );
  }
  if (provider?.note) notes.push(provider.note);
  return {
    type: recordType,
    host,
    target: expectedTarget,
    ttl_hint: provider?.ttlHint ?? "Auto · 4 hrs",
    registrar: provider?.label ?? "Generic / Other",
    steps: provider?.instructions ?? [
      "Open your registrar's DNS or zone editor.",
      `Add a new ${recordType} record.`,
      `Set Host / Name to "${host}".`,
      `Set Target / Value to "${expectedTarget}".`,
      "Set TTL to Auto or 4 hours.",
      "Save the record and wait for propagation.",
    ],
    notes,
  };
}
