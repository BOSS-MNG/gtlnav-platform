/**
 * Marketing top-nav items.
 *
 * Phase 5C.1 keeps the current hash-anchor behavior so the homepage continues
 * to scroll between sections. Phase 5C.2 will swap these hrefs for real routes
 * (`/platform`, `/infrastructure`, `/architecture`, `/docs`).
 */

export type NavItem = {
  label: string;
  href: string;
};

export const MARKETING_NAV_ITEMS: NavItem[] = [
  { label: "Platform", href: "#services" },
  { label: "Infrastructure", href: "#infrastructure" },
  { label: "Architecture", href: "#architecture" },
  { label: "Docs", href: "#footer" },
];
