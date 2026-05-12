"use client";

import type { ReactNode } from "react";

export function CardShell({
  eyebrow,
  title,
  description,
  right,
  children,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 backdrop-blur-2xl ${
        className ?? ""
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      {(eyebrow || title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {eyebrow ? (
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h3 className="mt-1 text-base font-semibold tracking-tight text-white md:text-lg">
                {title}
              </h3>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-2xl text-xs text-white/55">
                {description}
              </p>
            ) : null}
          </div>
          {right ? <div className="flex items-center gap-2">{right}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const accent =
    tone === "good"
      ? "from-basil-400/30 text-basil-200"
      : tone === "warn"
      ? "from-amber-400/30 text-amber-200"
      : tone === "bad"
      ? "from-red-400/30 text-red-200"
      : "from-white/15 text-white";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accent} via-white/10 to-transparent`}
      />
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${accent.split(" ")[1]}`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/40">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function StatusPill({
  label,
  tone = "default",
  pulse,
}: {
  label: string;
  tone?: "default" | "good" | "warn" | "bad" | "info";
  pulse?: boolean;
}) {
  const styles =
    tone === "good"
      ? "border-basil-400/40 bg-basil-500/10 text-basil-200"
      : tone === "warn"
      ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
      : tone === "bad"
      ? "border-red-400/40 bg-red-500/10 text-red-200"
      : tone === "info"
      ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
      : "border-white/15 bg-white/[0.04] text-white/70";

  const dotColor =
    tone === "good"
      ? "bg-basil-300"
      : tone === "warn"
      ? "bg-amber-300"
      : tone === "bad"
      ? "bg-red-400"
      : tone === "info"
      ? "bg-cyan-300"
      : "bg-white/50";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${styles}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dotColor} ${
          pulse ? "animate-pulse" : ""
        }`}
      />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
      <p className="text-sm font-medium text-white/80">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-white/50">{description}</p>
      ) : null}
    </div>
  );
}

export function AdminButton({
  children,
  onClick,
  tone = "default",
  busy,
  disabled,
  type = "button",
  size = "sm",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  size?: "sm" | "md";
  title?: string;
}) {
  const sizing =
    size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";
  const styles =
    tone === "primary"
      ? "bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 text-black font-semibold shadow-[0_0_24px_-8px_rgba(111,232,154,0.7)] hover:shadow-[0_0_36px_-5px_rgba(111,232,154,1)]"
      : tone === "danger"
      ? "border border-red-400/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
      : tone === "ghost"
      ? "text-white/70 hover:text-white"
      : "border border-white/10 bg-white/[0.03] text-white/80 hover:border-white/25 hover:text-white";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full transition-colors ${sizing} ${styles} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function FilterChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors ${
        active
          ? "border-red-400/40 bg-red-500/15 text-red-100"
          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"
      }`}
    >
      {label}
      {count !== undefined ? (
        <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.14em] text-white/70">
          {count}
        </span>
      ) : null}
    </button>
  );
}
