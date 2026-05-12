import type { SVGProps } from "react";

/**
 * Marketing icon system.
 *
 * These marks are visually distinct from the dashboard icon set in
 * `src/components/ui/icons.tsx` (heavier strokes, broader shapes). They are
 * kept in a dedicated module so the homepage and any future marketing pages
 * share the same source of truth without diluting the dashboard's icon
 * vocabulary.
 *
 * The canonical brand mark is the leaf — also persisted as a standalone asset
 * at `public/branding/gtlnav-leaf.svg`. The inline component below preserves
 * `currentColor` so the parent text color (typically `text-basil-300`)
 * propagates into the gradient, which keeps the premium glow effects working.
 */

type IconComponent = (props: SVGProps<SVGSVGElement>) => React.ReactElement;

/* -------------------------------------------------------------------------- */
/*  Brand mark                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Official GTLNAV leaf logo. Single source of truth for the marketing chrome
 * (navbar, footer, hero, floating leaf). Inherits color from `currentColor`
 * so it can be tinted via `text-*` utility classes.
 */
export const BasilLeaf: IconComponent = (props) => (
  <svg viewBox="0 0 64 64" fill="none" {...props}>
    <defs>
      <linearGradient id="leafG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
      </linearGradient>
    </defs>
    <path
      d="M32 4c-3 7-15 12-19 22-5 12 4 26 19 32 15-6 24-20 19-32C47 16 35 11 32 4Z"
      fill="url(#leafG)"
      stroke="currentColor"
      strokeOpacity="0.7"
      strokeWidth="1.2"
    />
    <path
      d="M32 8v50"
      stroke="currentColor"
      strokeOpacity="0.55"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      d="M32 18c-4 2-9 4-12 8M32 28c-5 2-10 4-13 9M32 38c-5 1-9 3-12 7M32 18c4 2 9 4 12 8M32 28c5 2 10 4 13 9M32 38c5 1 9 3 12 7"
      stroke="currentColor"
      strokeOpacity="0.45"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

/* -------------------------------------------------------------------------- */
/*  Generic marketing marks                                                   */
/* -------------------------------------------------------------------------- */

export const ArrowRight: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);

export const Compass: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="m15 9-2 6-4 2 2-6 4-2Z" fill="currentColor" fillOpacity="0.2" />
  </svg>
);

export const CloudIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.7-1A4.5 4.5 0 0 1 17.5 18Z" />
    <path d="M12 14v6M9 17h6" />
  </svg>
);

export const RocketIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M5 19c1-3 3-5 6-6l6-6c2-2 4-2 4-2s0 2-2 4l-6 6c-1 3-3 5-6 6Z" />
    <circle cx="14" cy="10" r="1.4" />
    <path d="M5 19c0-2 1-3 3-3M8 21c1-1 1-2 1-3" />
  </svg>
);

export const GlobeIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);

export const ShieldIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 3 4 6v6c0 5 3 8 8 9 5-1 8-4 8-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const ServerIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="3" y="4" width="18" height="6" rx="2" />
    <rect x="3" y="14" width="18" height="6" rx="2" />
    <path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" />
  </svg>
);

export const StorageIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);

export const PulseIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3 12h4l2-6 4 12 2-6h6" />
  </svg>
);

export const BoltIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="m13 3-9 12h7l-2 6 9-12h-7l2-6Z" />
  </svg>
);

export const ChipIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
    <path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3" />
  </svg>
);

export const EdgeIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="9" strokeDasharray="2 4" />
    <circle cx="12" cy="3.5" r="1.2" fill="currentColor" />
    <circle cx="20.5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="20.5" r="1.2" fill="currentColor" />
    <circle cx="3.5" cy="12" r="1.2" fill="currentColor" />
  </svg>
);

export const DnsIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const AiIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="6" cy="6" r="1.5" />
    <circle cx="18" cy="6" r="1.5" />
    <circle cx="6" cy="18" r="1.5" />
    <circle cx="18" cy="18" r="1.5" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7.2 7.2 10 10M17 7l-3 3M7 17l3-3M17 17l-3-3" />
  </svg>
);

export const NetworkIcon: IconComponent = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <circle cx="12" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="19" r="2" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <path d="M12 7v3M11 12 7 18M13 12l4 6M5 17a14 14 0 0 1 14 0" />
  </svg>
);
