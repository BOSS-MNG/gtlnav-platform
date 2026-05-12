import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  /**
   * Optional accessible label. When provided, the icon receives `role="img"`
   * and renders a <title>. When omitted, the icon is `aria-hidden`.
   */
  title?: string;
};

const STROKE_BASE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function withA11y({ title, ...rest }: IconProps) {
  if (title) {
    return {
      role: "img" as const,
      "aria-label": title,
      ...rest,
    };
  }
  return {
    "aria-hidden": true as const,
    focusable: false as const,
    ...rest,
  };
}

/* -------------------------------------------------------------------------- */
/*  Brand marks                                                               */
/*  Drawn as monochrome marks so they pick up the parent's text color.         */
/* -------------------------------------------------------------------------- */

export function GitHubIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      {...withA11y({ title, ...props })}
    >
      {title ? <title>{title}</title> : null}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 1.5C6.21 1.5 1.5 6.21 1.5 12c0 4.64 3 8.57 7.17 9.96.52.1.71-.23.71-.5 0-.25-.01-.92-.02-1.81-2.91.63-3.53-1.41-3.53-1.41-.48-1.21-1.17-1.53-1.17-1.53-.96-.66.07-.65.07-.65 1.06.07 1.62 1.09 1.62 1.09.94 1.62 2.47 1.15 3.07.88.1-.69.37-1.15.66-1.41-2.32-.27-4.76-1.16-4.76-5.16 0-1.14.41-2.07 1.07-2.79-.11-.27-.46-1.32.1-2.74 0 0 .87-.28 2.86 1.07A9.93 9.93 0 0 1 12 6.55c.88 0 1.77.12 2.6.35 1.99-1.35 2.86-1.07 2.86-1.07.56 1.42.21 2.47.1 2.74.66.72 1.06 1.65 1.06 2.79 0 4.01-2.45 4.89-4.78 5.15.38.32.71.95.71 1.92 0 1.39-.01 2.51-.01 2.85 0 .27.19.6.72.5A10.51 10.51 0 0 0 22.5 12C22.5 6.21 17.79 1.5 12 1.5Z"
      />
    </svg>
  );
}

export function GitLabIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      {...withA11y({ title, ...props })}
    >
      {title ? <title>{title}</title> : null}
      <path d="M23.95 13.18 22.6 9.04l-2.69-8.27a.46.46 0 0 0-.88 0l-2.69 8.27H7.66L4.97.77a.46.46 0 0 0-.88 0L1.4 9.04.05 13.18a.93.93 0 0 0 .34 1.04L12 22.7l11.61-8.48a.93.93 0 0 0 .34-1.04Z" />
    </svg>
  );
}

export function BitbucketIcon({ title, ...props }: IconProps) {
  // Stylized monochrome representation of the Bitbucket bucket mark.
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      {...withA11y({ title, ...props })}
    >
      {title ? <title>{title}</title> : null}
      <path d="M2.65 3a.6.6 0 0 0-.6.7l2.85 16.65a.83.83 0 0 0 .8.69h12.55a.6.6 0 0 0 .6-.5l2.85-16.84a.6.6 0 0 0-.6-.7H2.65Zm11.45 11.4h-4.2L9 9.6h6l-.9 4.8Z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Workspace icons (consistent stroke style)                                 */
/* -------------------------------------------------------------------------- */

export function OverviewIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" />
      <path d="M3 11h18" />
    </svg>
  );
}

export function RocketIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M14 4c4 1 6 3 7 7-4 0-6 1-7 2" />
      <path d="M4 14c1-4 3-6 7-7 0 4 1 6 2 7" />
      <path d="M9.5 14.5 4 20" />
      <path d="m11.5 16.5 1 4 4-2-1.5-2" />
      <path d="M14 10a1.5 1.5 0 1 1-1.5-1.5" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01" />
      <path d="M7 17h.01" />
      <path d="M11 7h6" />
      <path d="M11 17h6" />
    </svg>
  );
}

export function PlugIcon(props: IconProps) {
  // Used for "Integrations".
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 2v4" />
      <path d="M15 2v4" />
      <rect x="6" y="6" width="12" height="6" rx="1.5" />
      <path d="M9 12v4a3 3 0 0 0 6 0v-4" />
      <path d="M12 19v3" />
    </svg>
  );
}

export function WebhookIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M9 11a3 3 0 1 0-3-5.2" />
      <path d="M15 13a3 3 0 1 0 5.2 3" />
      <path d="M5.5 16.5A3 3 0 1 0 8 21h7" />
      <path d="m11 11 3 5" />
      <path d="m9.5 13.5 5 0" />
    </svg>
  );
}

export function CardIcon(props: IconProps) {
  // Used for "Billing".
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

export function LifebuoyIcon(props: IconProps) {
  // Used for "Support".
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="m4.7 4.7 3.6 3.6" />
      <path d="m15.7 15.7 3.6 3.6" />
      <path d="m4.7 19.3 3.6-3.6" />
      <path d="m15.7 8.3 3.6-3.6" />
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .68.4 1.29 1 1.51.62.26 1.34.13 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.22.6.83 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.68 0-1.29.4-1.51 1Z" />
    </svg>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="8" cy="14" r="4" />
      <path d="m11 11 9-9" />
      <path d="m17 5 3 3" />
      <path d="m14 8 3 3" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 3 5 6v6c0 4.5 3.2 7.7 7 9 3.8-1.3 7-4.5 7-9V6l-7-3Z" />
      <path d="m9.5 12 2 2 3.5-4" />
    </svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7 9 3 3-3 3" />
      <path d="M12.5 15h4.5" />
    </svg>
  );
}

export function GitBranchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 7v10" />
      <path d="M18 11a4 4 0 0 1-4 4H8" />
    </svg>
  );
}

export function ActivityIcon(props: IconProps) {
  // Used for "Analytics".
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 12h3.5l2-6 4 12 2-6h6.5" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 19h16" />
      <path d="M6 17V9" />
      <path d="M11 17V5" />
      <path d="M16 17v-7" />
    </svg>
  );
}

export function PulseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 12h4l2-5 4 10 2-7 2 4h4" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  // Used for "Team" / "Members".
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14h.5c2.3 0 4 1.4 4.5 4" />
    </svg>
  );
}

export function UserPlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3 20c.9-3.4 3.4-5 7-5h.5" />
      <path d="M19 13v6" />
      <path d="M16 16h6" />
    </svg>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 8.5 6.5 14 12 6l5.5 8L21 8.5 19.5 18h-15Z" />
      <path d="M5 18h14" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="4" y="3.5" width="11" height="17" rx="1.5" />
      <path d="M15 9h4a1.5 1.5 0 0 1 1.5 1.5v9a1 1 0 0 1-1 1H15" />
      <path d="M7 7h2" />
      <path d="M11 7h2" />
      <path d="M7 11h2" />
      <path d="M11 11h2" />
      <path d="M7 15h2" />
      <path d="M11 15h2" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Stacked planes — Runtime / build fleet. */
export function LayersIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="m3 12 9 4.5L21 12" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}

/** Half-circle gauge — Usage metering / quotas. */
export function GaugeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3.5 16a8.5 8.5 0 0 1 17 0" />
      <path d="M12 16 16 9" />
      <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Bell — notification center. */
export function BellIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M6 16V11a6 6 0 1 1 12 0v5" />
      <path d="M4.5 17.5h15" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** Lightning bolt — Edge functions / runtime. */
export function ZapIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M13.5 2.5 4 13.5h6.5L9 21.5 19 10.5h-6.5l1-8Z" />
    </svg>
  );
}

/** Padlock — security center. */
export function LockIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V7a4 4 0 1 1 8 0v3.5" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Fingerprint — MFA / biometric. */
export function FingerprintIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...STROKE_BASE} {...withA11y(props)}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M5 12a7 7 0 0 1 14 0v3" />
      <path d="M8.5 12a3.5 3.5 0 1 1 7 0v3a4 4 0 0 1-4 4" />
      <path d="M12 12v5" />
      <path d="M5.5 16.5a8 8 0 0 0 1.7 3.5" />
      <path d="M18.5 16a8 8 0 0 1-2 4" />
    </svg>
  );
}
