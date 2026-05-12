/**
 * Marketing footer link data.
 *
 * Phase 5C.1 keeps every link as `href="#"` (matching current homepage
 * behavior). Phase 5C.5 will replace each `href` with a real marketing route
 * once those pages exist.
 */

export type FooterLink = {
  label: string;
  href: string;
};

export type FooterColumn = {
  title: string;
  items: FooterLink[];
};

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Platform",
    items: [
      { label: "Cloud Hosting", href: "#" },
      { label: "App Deployment", href: "#" },
      { label: "Domains", href: "#" },
      { label: "SSL Security", href: "#" },
      { label: "VPS Infrastructure", href: "#" },
      { label: "Cloud Storage", href: "#" },
    ],
  },
  {
    title: "Network",
    items: [
      { label: "Edge Map", href: "#" },
      { label: "Global PoPs", href: "#" },
      { label: "Status", href: "#" },
      { label: "BGP & Peering", href: "#" },
      { label: "Latency", href: "#" },
    ],
  },
  {
    title: "Resources",
    items: [
      { label: "Documentation", href: "#" },
      { label: "Status", href: "#" },
      { label: "Changelog", href: "#" },
      { label: "API", href: "#" },
      { label: "CLI", href: "#" },
    ],
  },
  {
    title: "Company",
    items: [
      { label: "About", href: "#" },
      { label: "Manifesto", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Press", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
];

export const FOOTER_SOCIALS: FooterLink[] = [
  { label: "Twitter", href: "#" },
  { label: "GitHub", href: "#" },
  { label: "LinkedIn", href: "#" },
  { label: "Discord", href: "#" },
];
