import { GlobeIcon } from "@/src/components/marketing/marketing-icons";
import {
  WORLD_DOTS,
  POPS,
  POP_BY_ID,
  ROUTES,
  arcPath,
} from "@/src/lib/marketing/edge-map";

export function EdgeNetworkMap() {
  return (
    <div className="reveal-up relative lg:col-span-8">
      <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/30 via-basil-500/10 to-transparent opacity-60 blur-md" />

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl shadow-[0_0_80px_-30px_rgba(111,232,154,0.6)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10">
              <GlobeIcon className="h-4 w-4 text-basil-300" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-wide text-white">
                Global Edge Network
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-basil-300/80">
                gtlnav://map/edge
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1 text-basil-200 backdrop-blur-xl">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-basil-300" />
              </span>
              Live
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-white/55">
              240 PoPs
            </span>
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-white/55">
              12 regions
            </span>
          </div>
        </div>

        <div className="relative aspect-[16/7] w-full overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(111,232,154,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.55) 1px, transparent 1px)",
              backgroundSize: "30px 30px",
              maskImage:
                "radial-gradient(ellipse at center, black 35%, transparent 75%)",
              WebkitMaskImage:
                "radial-gradient(ellipse at center, black 35%, transparent 75%)",
            }}
          />

          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(111,232,154,0.15),transparent_60%)]" />

          <svg
            viewBox="0 0 900 240"
            className="absolute inset-0 h-full w-full"
            fill="none"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="meridian" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(111,232,154,0)" />
                <stop offset="50%" stopColor="rgba(111,232,154,0.25)" />
                <stop offset="100%" stopColor="rgba(111,232,154,0)" />
              </linearGradient>
              <linearGradient id="arcStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(111,232,154,0)" />
                <stop offset="50%" stopColor="rgba(111,232,154,0.7)" />
                <stop offset="100%" stopColor="rgba(111,232,154,0)" />
              </linearGradient>
              <radialGradient id="popGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(111,232,154,0.9)" />
                <stop offset="100%" stopColor="rgba(111,232,154,0)" />
              </radialGradient>
            </defs>

            {[120, 240, 360, 480, 600, 720, 840].map((x) => (
              <line
                key={`mer-${x}`}
                x1={x}
                y1="0"
                x2={x}
                y2="240"
                stroke="url(#meridian)"
                strokeWidth="0.5"
              />
            ))}
            {[40, 80, 120, 160, 200].map((y) => (
              <line
                key={`par-${y}`}
                x1="0"
                y1={y}
                x2="900"
                y2={y}
                stroke="rgba(111,232,154,0.06)"
                strokeWidth="0.5"
                strokeDasharray="2 6"
              />
            ))}

            {WORLD_DOTS.flatMap((row, r) =>
              row.split("").map((cell, c) =>
                cell === "#" ? (
                  <circle
                    key={`d-${r}-${c}`}
                    cx={c * 20 + 10}
                    cy={r * 20 + 10}
                    r="1.4"
                    fill="rgba(111,232,154,0.55)"
                  />
                ) : null,
              ),
            )}

            {ROUTES.map(([a, b], i) => {
              const A = POP_BY_ID[a];
              const B = POP_BY_ID[b];
              if (!A || !B) return null;
              const d = arcPath(A.x, A.y, B.x, B.y);
              return (
                <g key={`r-${i}`}>
                  <path
                    d={d}
                    stroke="url(#arcStroke)"
                    strokeWidth="1"
                    fill="none"
                  />
                  <path
                    d={d}
                    stroke="rgba(111,232,154,0.95)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeDasharray="14 200"
                    fill="none"
                    className="animate-dash-flow"
                    style={{
                      animationDelay: `${(i * 0.45) % 4}s`,
                      animationDuration: `${4 + (i % 3) * 0.6}s`,
                    }}
                  />
                  <path
                    d={d}
                    stroke="rgba(255,255,255,0.95)"
                    strokeWidth="0.7"
                    strokeLinecap="round"
                    strokeDasharray="2 320"
                    fill="none"
                    className="animate-dash-flow"
                    style={{
                      animationDelay: `${(i * 0.6 + 1.5) % 5}s`,
                      animationDuration: "5s",
                    }}
                  />
                </g>
              );
            })}

            {POPS.map((p, i) => (
              <g key={p.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="14"
                  fill="url(#popGlow)"
                  className="animate-pulse-soft"
                  style={{ animationDelay: `${(i * 0.27) % 2.4}s` }}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.primary ? 4.5 : 3.2}
                  fill="rgba(111,232,154,1)"
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth="0.8"
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.primary ? 14 : 10}
                  stroke="rgba(111,232,154,0.8)"
                  strokeWidth="1"
                  fill="none"
                  className="animate-pulse-wave"
                  style={{
                    transformOrigin: `${p.x}px ${p.y}px`,
                    animationDelay: `${(i * 0.4) % 3.5}s`,
                  }}
                />
              </g>
            ))}
          </svg>

          {POPS.filter((p) => p.primary).map((p) => (
            <div
              key={`label-${p.id}`}
              className="pointer-events-none absolute hidden font-mono text-[10px] uppercase tracking-[0.22em] text-basil-200 md:block"
              style={{
                left: `${(p.x / 900) * 100}%`,
                top: `${(p.y / 240) * 100}%`,
                transform: "translate(8px, -130%)",
              }}
            >
              <span className="rounded-md border border-basil-400/30 bg-black/60 px-2 py-1 backdrop-blur-xl">
                {p.region}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/[0.02] sm:grid-cols-4">
          {[
            { v: "240+", l: "Edge PoPs" },
            { v: "12", l: "Regions" },
            { v: "1.4 ms", l: "Inter-PoP" },
            { v: "8 Tier-1", l: "Networks" },
          ].map((s) => (
            <div key={s.l} className="bg-black/40 px-5 py-3 backdrop-blur-xl">
              <div className="bg-gradient-to-r from-white to-basil-200 bg-clip-text text-base font-semibold text-transparent">
                {s.v}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-white/45">
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
