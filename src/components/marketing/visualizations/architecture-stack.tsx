import { ServerIcon } from "@/src/components/marketing/marketing-icons";
import { ARCHITECTURE_LAYERS } from "@/src/lib/marketing/architecture";

export function ArchitectureStack() {
  return (
    <div className="reveal-up relative lg:col-span-4">
      <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/30 via-basil-500/10 to-transparent opacity-60 blur-md" />

      <div className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-5 backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10">
              <ServerIcon className="h-4 w-4 text-basil-300" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide text-white">
                Infrastructure Stack
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-basil-300/80">
                gtlnav://stack
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-basil-400/30 bg-basil-500/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-basil-200 backdrop-blur-xl">
            <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,1)]" />
            Online
          </span>
        </div>

        <div className="mt-5 space-y-2.5">
          {ARCHITECTURE_LAYERS.map((l, i) => (
            <div
              key={l.n}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-xl transition-all duration-500 hover:border-basil-400/40"
            >
              <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-basil-400/30 via-transparent to-transparent opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
              <div className="relative flex items-center gap-3">
                <div className="font-mono text-[10px] tracking-[0.22em] text-basil-300/70">
                  {l.n}
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10">
                  <l.Icon className="h-4 w-4 text-basil-300" />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-semibold tracking-tight text-white">
                    {l.title}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
                    {l.meta}
                  </div>
                </div>
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span
                    className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75"
                    style={{ animationDelay: `${i * 0.4}s` }}
                  />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${l.accent} bg-[length:200%_100%] animate-shimmer`}
                    style={{ width: `${l.fill}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-white/45">
                  {l.fill}%
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
          <span>Topology</span>
          <span className="inline-flex items-center gap-1.5 text-basil-300/80">
            <span className="h-1.5 w-1.5 rounded-full bg-basil-300 animate-pulse-soft" />
            Self-healing
          </span>
        </div>
      </div>
    </div>
  );
}
