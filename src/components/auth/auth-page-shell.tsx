import type { ReactNode } from "react";
import Link from "next/link";

type AuthPageShellProps = {
  children: ReactNode;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
};

export function AuthPageShell({
  children,
  title,
  subtitle,
  footer,
}: AuthPageShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div className="absolute -top-40 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-basil-500/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-600/15 blur-[100px]" />
        <div className="absolute top-1/2 left-0 h-[20rem] w-[20rem] -translate-y-1/2 rounded-full bg-emerald-500/10 blur-[90px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(111,232,154,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at center, black 25%, transparent 70%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 25%, transparent 70%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/50 to-transparent" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
        <Link
          href="/"
          className="mb-8 flex items-center gap-3 transition-opacity hover:opacity-90"
        >
          <div className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-gradient-to-br from-basil-500/20 to-basil-700/10 shadow-[0_0_24px_-6px_rgba(111,232,154,0.5)] backdrop-blur-xl">
            <span className="text-xs font-bold tracking-[0.2em] text-basil-300">
              G
            </span>
          </div>
          <div className="leading-tight">
            <span className="text-sm font-semibold tracking-[0.32em] text-white">
              GTLNAV
            </span>
            <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
              by GODTECHLABS
            </span>
          </div>
        </Link>

        <div className="pointer-events-none absolute -inset-px mx-auto max-w-md rounded-3xl bg-gradient-to-br from-basil-400/25 via-basil-500/10 to-transparent opacity-70 blur-xl sm:max-w-lg" />

        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-8 shadow-[0_0_60px_-20px_rgba(111,232,154,0.35)] backdrop-blur-2xl sm:max-w-lg sm:p-10">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/50 to-transparent" />

          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-sm text-white/55 sm:text-base">{subtitle}</p>
            ) : null}
          </div>

          {children}

          {footer ? (
            <div className="mt-8 border-t border-white/10 pt-6 text-center text-sm text-white/50">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
