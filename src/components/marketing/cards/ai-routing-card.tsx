import { ArchitectureCardShell } from "@/src/components/marketing/cards/architecture-card-shell";

export function AiRoutingCard() {
  return (
    <ArchitectureCardShell
      eyebrow="// ai-traffic"
      title="AI Traffic Routing"
      desc="Adaptive ML steering predicts load, latency and intent — picking the optimal PoP per request, in real time."
    >
      <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        <svg viewBox="0 0 320 128" className="h-full w-full" fill="none">
          <defs>
            <linearGradient id="aiArc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(111,232,154,0)" />
              <stop offset="50%" stopColor="rgba(111,232,154,0.85)" />
              <stop offset="100%" stopColor="rgba(111,232,154,0)" />
            </linearGradient>
          </defs>

          <g>
            <circle
              cx="40"
              cy="64"
              r="14"
              fill="rgba(111,232,154,0.1)"
              stroke="rgba(111,232,154,0.5)"
            />
            <text
              x="40"
              y="68"
              textAnchor="middle"
              fontSize="9"
              fill="rgba(255,255,255,0.7)"
              fontFamily="monospace"
            >
              REQ
            </text>
          </g>

          <g>
            <circle
              cx="160"
              cy="64"
              r="22"
              fill="rgba(111,232,154,0.15)"
              stroke="rgba(111,232,154,0.7)"
            />
            <circle
              cx="160"
              cy="64"
              r="32"
              stroke="rgba(111,232,154,0.3)"
              strokeDasharray="2 4"
              fill="none"
              className="animate-spin-slow"
              style={{ transformOrigin: "160px 64px" }}
            />
            <text
              x="160"
              y="68"
              textAnchor="middle"
              fontSize="9"
              fill="rgba(255,255,255,0.85)"
              fontFamily="monospace"
            >
              AI
            </text>
          </g>

          {[24, 48, 80].map((y, i) => (
            <g key={i}>
              <circle
                cx="280"
                cy={y}
                r="6"
                fill="rgba(111,232,154,0.2)"
                stroke="rgba(111,232,154,0.4)"
              />
              <line
                x1="184"
                y1="64"
                x2="280"
                y2={y}
                stroke="rgba(111,232,154,0.15)"
                strokeWidth="0.6"
              />
            </g>
          ))}
          <g>
            <circle
              cx="280"
              cy="104"
              r="8"
              fill="rgba(111,232,154,0.4)"
              stroke="rgba(111,232,154,1)"
            />
            <line
              x1="184"
              y1="64"
              x2="280"
              y2="104"
              stroke="url(#aiArc)"
              strokeWidth="1.5"
              strokeDasharray="6 80"
              className="animate-dash-flow"
            />
            <text
              x="280"
              y="124"
              textAnchor="middle"
              fontSize="8"
              fill="rgba(111,232,154,0.9)"
              fontFamily="monospace"
            >
              OPTIMAL
            </text>
          </g>

          <line
            x1="54"
            y1="64"
            x2="138"
            y2="64"
            stroke="url(#aiArc)"
            strokeWidth="1.5"
            strokeDasharray="6 80"
            className="animate-dash-flow"
          />
        </svg>
      </div>

      <ul className="mt-4 space-y-1.5 font-mono text-[11px] text-white/55">
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          98.7% prediction accuracy
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          0.4 ms decision latency
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          12k req/s per inference node
        </li>
      </ul>
    </ArchitectureCardShell>
  );
}
