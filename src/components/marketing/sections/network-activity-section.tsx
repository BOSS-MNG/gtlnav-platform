import { ActivityRow } from "@/src/components/marketing/visualizations/activity-row";
import { ACTIVITY_EVENTS } from "@/src/lib/marketing/activity";

const LEGEND: { c: string; l: string }[] = [
  { c: "bg-basil-300", l: "Healthy" },
  { c: "bg-cyan-300", l: "Info" },
  { c: "bg-amber-300", l: "Auto-heal" },
  { c: "bg-fuchsia-300", l: "Deploy" },
];

export function NetworkActivitySection() {
  const stream = [...ACTIVITY_EVENTS, ...ACTIVITY_EVENTS];

  return (
    <section
      id="activity"
      className="relative mx-auto max-w-7xl px-6 py-20 md:px-10 md:py-28"
    >
      <div className="reveal-up grid gap-10 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-4 py-1.5 text-xs uppercase tracking-[0.28em] text-basil-200 backdrop-blur-xl">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-basil-300" />
            </span>
            Live Stream
          </div>
          <h3 className="mt-6 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
            <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              The infrastructure
            </span>{" "}
            <span className="bg-gradient-to-r from-basil-200 to-basil-400 bg-clip-text text-transparent">
              is breathing.
            </span>
          </h3>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/55">
            Real-time events from the GTLNAV control plane — deployments, edge
            sync, certificate rotations and self-healing operations across the
            global mesh.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3 text-xs">
            {LEGEND.map((d) => (
              <span
                key={d.l}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-white/65 backdrop-blur-xl"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${d.c}`} />
                {d.l}
              </span>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="group relative">
            <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/30 via-basil-500/10 to-transparent opacity-60 blur-md" />
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/60 backdrop-blur-2xl shadow-[0_0_60px_-20px_rgba(111,232,154,0.5)]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,1)]" />
                  <span className="ml-3 font-mono text-xs text-white/50">
                    gtlnav://system/activity
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.22em] text-basil-300/80">
                  <span className="hidden sm:inline">tail -f /var/log/cloud</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
                    </span>
                    Live
                  </span>
                </div>
              </div>

              <div
                className="absolute inset-x-0 top-12 h-24 bg-gradient-to-b from-black to-transparent z-10"
                aria-hidden
              />
              <div
                className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black to-transparent z-10"
                aria-hidden
              />

              <div
                className="relative h-[26rem] overflow-hidden font-mono text-sm"
                style={{
                  maskImage:
                    "linear-gradient(180deg, transparent 0%, black 12%, black 88%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(180deg, transparent 0%, black 12%, black 88%, transparent 100%)",
                }}
              >
                <div className="animate-feed-loop">
                  {stream.map((e, i) => (
                    <ActivityRow key={i} event={e} index={i} />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 font-mono text-[11px] text-white/40">
                <span className="text-basil-300/80">$ stream connected</span>
                <span>events/min · {ACTIVITY_EVENTS.length * 6}</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-basil-300">●</span> 240 PoPs
                </span>
                <span className="hidden md:inline">latency · 1.4 ms</span>
                <span className="inline-flex items-center">
                  <span className="text-basil-300 animate-blink">▍</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
