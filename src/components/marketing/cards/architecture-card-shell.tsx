import type { ReactNode } from "react";

type ArchitectureCardShellProps = {
  eyebrow: string;
  title: string;
  desc: string;
  children: ReactNode;
};

export function ArchitectureCardShell({
  eyebrow,
  title,
  desc,
  children,
}: ArchitectureCardShellProps) {
  return (
    <div className="group reveal-up relative">
      <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-6 backdrop-blur-2xl transition-all duration-500 group-hover:-translate-y-1 group-hover:border-basil-400/40">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-basil-300/80">
          {eyebrow}
        </div>
        <h4 className="mt-2 text-lg font-semibold tracking-tight text-white">
          {title}
        </h4>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{desc}</p>

        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
