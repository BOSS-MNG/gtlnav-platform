export type DnsProviderValue =
  | "squarespace"
  | "godaddy"
  | "namecheap"
  | "cloudflare"
  | "hostinger"
  | "ionos"
  | "ovh"
  | "other";

export type DnsProvider = {
  value: DnsProviderValue;
  label: string;
  /** UI hint for default TTL behavior at this registrar. */
  ttlHint: string;
  /** Step-by-step instructions for adding a CNAME record. */
  instructions: string[];
  /** Optional inline note to surface on the setup card. */
  note?: string;
};

export const DEFAULT_DNS_TARGET = "cname.vercel-dns.com";

export const DNS_PROVIDERS: DnsProvider[] = [
  {
    value: "squarespace",
    label: "Squarespace",
    ttlHint: "Auto · 4 hrs",
    instructions: [
      "Open your Squarespace account and go to Domains.",
      "Select the domain you want to connect.",
      "Open DNS Settings.",
      "Click Add Record and choose CNAME.",
      "Set Host to your subdomain (e.g. app).",
      `Set Points To to ${DEFAULT_DNS_TARGET}.`,
      "Save the record and wait for propagation.",
    ],
  },
  {
    value: "godaddy",
    label: "GoDaddy",
    ttlHint: "Auto · 1 hr",
    instructions: [
      "Sign in to GoDaddy and open My Products.",
      "Find your domain and click DNS.",
      "Click Add and choose CNAME.",
      "Set Name to your subdomain (e.g. app).",
      `Set Value to ${DEFAULT_DNS_TARGET}.`,
      "Leave TTL on default or set to 1 hour.",
      "Click Save.",
    ],
  },
  {
    value: "namecheap",
    label: "Namecheap",
    ttlHint: "Automatic",
    instructions: [
      "Sign in to Namecheap and open Domain List.",
      "Click Manage on the relevant domain.",
      "Open the Advanced DNS tab.",
      "Click Add New Record and choose CNAME Record.",
      "Set Host to your subdomain.",
      `Set Value to ${DEFAULT_DNS_TARGET}.`,
      "Set TTL to Automatic, then save the record.",
    ],
  },
  {
    value: "cloudflare",
    label: "Cloudflare",
    ttlHint: "Auto",
    instructions: [
      "Open Cloudflare and select the domain.",
      "Go to DNS → Records.",
      "Click Add record and choose CNAME.",
      "Set Name to your subdomain.",
      `Set Target to ${DEFAULT_DNS_TARGET}.`,
      "Set Proxy status to DNS only (recommended during verification).",
      "Save.",
    ],
    note: "Keep Proxy status set to DNS only until verification succeeds. You can re-enable the orange cloud afterwards.",
  },
  {
    value: "hostinger",
    label: "Hostinger",
    ttlHint: "14400 · 4 hrs",
    instructions: [
      "Sign in to hPanel and open Domains.",
      "Select your domain and open DNS / Nameservers.",
      "Click Add new record and choose CNAME.",
      "Set Name to your subdomain.",
      `Set Points To to ${DEFAULT_DNS_TARGET}.`,
      "Set TTL to 14400 (4 hrs).",
      "Save the record.",
    ],
  },
  {
    value: "ionos",
    label: "IONOS",
    ttlHint: "Auto · 1 hr",
    instructions: [
      "Sign in to IONOS and open Domains & SSL.",
      "Click your domain, then open DNS.",
      "Click Add record and choose CNAME.",
      "Set Host name to your subdomain.",
      `Set Points to to ${DEFAULT_DNS_TARGET}.`,
      "Save.",
    ],
  },
  {
    value: "ovh",
    label: "OVH",
    ttlHint: "Default · 1 hr",
    instructions: [
      "Open the OVH Control Panel and go to Web Cloud → Domains.",
      "Select your domain and open the DNS zone tab.",
      "Click Add an entry and choose CNAME.",
      "Set Sub-domain to the prefix (e.g. app).",
      `Set Target to ${DEFAULT_DNS_TARGET}. (note the trailing dot when prompted)`,
      "Confirm and wait for the zone to regenerate.",
    ],
  },
  {
    value: "other",
    label: "Other / Generic",
    ttlHint: "Auto · 4 hrs",
    instructions: [
      "Open your registrar's DNS or zone editor.",
      "Add a new CNAME record.",
      "Set Host / Name to your subdomain (or @ if your registrar supports CNAME flattening / ALIAS at root).",
      `Set Target / Value to ${DEFAULT_DNS_TARGET}.`,
      "Set TTL to Auto or 4 hours.",
      "Save the record and wait for propagation.",
    ],
  },
];

const PROVIDER_BY_VALUE = new Map<string, DnsProvider>(
  DNS_PROVIDERS.map((p) => [p.value, p]),
);

const PROVIDER_BY_LABEL = new Map<string, DnsProvider>(
  DNS_PROVIDERS.map((p) => [p.label.toLowerCase(), p]),
);

export function getDnsProvider(
  value: string | null | undefined,
): DnsProvider | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const byValue = PROVIDER_BY_VALUE.get(trimmed.toLowerCase());
  if (byValue) return byValue;
  const byLabel = PROVIDER_BY_LABEL.get(trimmed.toLowerCase());
  if (byLabel) return byLabel;
  return null;
}

export function dnsProviderLabel(value: string | null | undefined): string {
  return getDnsProvider(value)?.label ?? "Not specified";
}

/**
 * Returns the DNS host portion to enter at the registrar.
 * - Apex domains (example.com / example.co.uk-style 2-label) return "@".
 * - Subdomains (app.example.com) return the leading label(s).
 */
export function dnsRecordHost(domain: string | null | undefined): string {
  if (!domain) return "@";
  const cleaned = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!cleaned) return "@";
  const parts = cleaned.split(".").filter(Boolean);
  if (parts.length <= 2) return "@";
  return parts.slice(0, -2).join(".");
}

export function isApexDomain(domain: string | null | undefined): boolean {
  return dnsRecordHost(domain) === "@";
}
