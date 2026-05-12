import { ArchitectureCardShell } from "@/src/components/marketing/cards/architecture-card-shell";

const TOPOLOGY_NODES = [
  { x: 160, y: 64, r: 8, primary: true },
  { x: 60, y: 30, r: 5 },
  { x: 60, y: 98, r: 5 },
  { x: 260, y: 30, r: 5 },
  { x: 260, y: 98, r: 5 },
  { x: 110, y: 18, r: 3 },
  { x: 210, y: 18, r: 3 },
  { x: 110, y: 110, r: 3 },
  { x: 210, y: 110, r: 3 },
];

const TOPOLOGY_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 5],
  [3, 6],
  [2, 7],
  [4, 8],
  [1, 3],
  [2, 4],
  [5, 6],
  [7, 8],
];

export function NetworkTopologyCard() {
  return (
    <ArchitectureCardShell
      eyebrow="// server-mesh"
      title="Network Topology"
      desc="Private overlay mesh with WireGuard tunnels, smart shaping and automatic peering — every node a first-class citizen."
    >
      <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        <svg viewBox="0 0 320 128" className="h-full w-full" fill="none">
          <defs>
            <linearGradient id="meshArc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(111,232,154,0)" />
              <stop offset="50%" stopColor="rgba(111,232,154,0.6)" />
              <stop offset="100%" stopColor="rgba(111,232,154,0)" />
            </linearGradient>
          </defs>

          {TOPOLOGY_EDGES.map(([a, b], i) => {
            const A = TOPOLOGY_NODES[a];
            const B = TOPOLOGY_NODES[b];
            return (
              <g key={i}>
                <line
                  x1={A.x}
                  y1={A.y}
                  x2={B.x}
                  y2={B.y}
                  stroke="rgba(111,232,154,0.18)"
                  strokeWidth="0.7"
                />
                <line
                  x1={A.x}
                  y1={A.y}
                  x2={B.x}
                  y2={B.y}
                  stroke="url(#meshArc)"
                  strokeWidth="1.2"
                  strokeDasharray="6 60"
                  strokeLinecap="round"
                  className="animate-dash-flow"
                  style={{
                    animationDelay: `${(i * 0.35) % 3}s`,
                    animationDuration: `${3 + (i % 3) * 0.8}s`,
                  }}
                />
              </g>
            );
          })}

          {TOPOLOGY_NODES.map((n, i) => (
            <g key={i}>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r + 4}
                stroke="rgba(111,232,154,0.4)"
                strokeWidth="0.6"
                fill="none"
                className="animate-pulse-wave"
                style={{
                  transformOrigin: `${n.x}px ${n.y}px`,
                  animationDelay: `${i * 0.35}s`,
                }}
              />
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill={n.primary ? "rgba(111,232,154,1)" : "rgba(111,232,154,0.6)"}
                stroke="rgba(255,255,255,0.7)"
                strokeWidth="0.6"
              />
            </g>
          ))}
        </svg>
      </div>

      <ul className="mt-4 space-y-1.5 font-mono text-[11px] text-white/55">
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          mTLS 1.3 + WireGuard tunnels
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          Auto-peering across 8 Tier-1s
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          Sub-millisecond convergence
        </li>
      </ul>
    </ArchitectureCardShell>
  );
}
