"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = {
  href?: string;
  label: string;
};

export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  back?: { href: string; label?: string } | null;
};

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  breadcrumbs,
  actions,
  back,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-white/10 pb-5">
      {(breadcrumbs && breadcrumbs.length > 0) || back ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
          {back ? (
            <Link
              href={back.href}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 transition-colors hover:border-white/25 hover:text-white"
            >
              ← {back.label ?? "Back"}
            </Link>
          ) : null}
          {breadcrumbs?.map((c, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={`${c.label}-${i}`} className="inline-flex items-center gap-2">
                {i > 0 ? <span className="text-white/20">/</span> : null}
                {c.href && !isLast ? (
                  <Link
                    href={c.href}
                    className="text-white/55 transition-colors hover:text-white"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-white/85">{c.label}</span>
                )}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm text-white/55">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
