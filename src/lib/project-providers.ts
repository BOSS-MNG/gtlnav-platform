export const PROVIDER_OPTIONS = [
  { label: "GTLNAV Edge", value: "gtlnav_edge" },
  { label: "GTLNAV VPS", value: "gtlnav_vps" },
  { label: "GTLNAV Static", value: "gtlnav_static" },
  { label: "GTLNAV Container", value: "gtlnav_container" },
] as const;

export type ProviderLabel = (typeof PROVIDER_OPTIONS)[number]["label"];
export type ProviderValue = (typeof PROVIDER_OPTIONS)[number]["value"];

const LABEL_TO_VALUE = new Map<string, ProviderValue>(
  PROVIDER_OPTIONS.map((p) => [p.label, p.value]),
);

const VALUE_TO_LABEL = new Map<string, ProviderLabel>(
  PROVIDER_OPTIONS.map((p) => [p.value, p.label]),
);

export function normalizeProvider(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  const exact = LABEL_TO_VALUE.get(trimmed);
  if (exact) return exact;
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function providerLabel(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  const fromValue = VALUE_TO_LABEL.get(trimmed);
  if (fromValue) return fromValue;
  const fromValueCi = VALUE_TO_LABEL.get(trimmed.toLowerCase());
  if (fromValueCi) return fromValueCi;
  if (LABEL_TO_VALUE.has(trimmed)) return trimmed;
  return trimmed;
}
