import type { ComponentType, SVGProps } from "react";

type MetricCardProps = {
  value: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export function MetricCard({ value, label, Icon }: MetricCardProps) {
  return (
    <div className="group relative">
      <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-50 blur-md" />
      <div className="relative overflow-hidden rounded-2xl border border-basil-400/30 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-3.5 backdrop-blur-2xl shadow-[0_0_30px_-10px_rgba(111,232,154,0.55)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/70 to-transparent" />
        <div className="absolute -top-12 -right-12 h-24 w-24 rounded-full bg-basil-400/30 blur-2xl animate-pulse-glow" />

        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10">
            <Icon className="h-4 w-4 text-basil-300" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="bg-gradient-to-r from-white to-basil-200 bg-clip-text text-lg font-semibold tracking-tight text-transparent">
              {value}
            </div>
            <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.22em] text-white/50">
              {label}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-basil-500 via-basil-300 to-basil-500 bg-[length:200%_100%] animate-shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}
