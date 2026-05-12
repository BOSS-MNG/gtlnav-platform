import { ArchitectureCardShell } from "@/src/components/marketing/cards/architecture-card-shell";

const STORAGE_NODES = [
  { x: 60, y: 30, label: "REGION-A" },
  { x: 260, y: 30, label: "REGION-B" },
  { x: 60, y: 98, label: "REGION-C" },
  { x: 260, y: 98, label: "REGION-D" },
];

const STORAGE_LINKS: [string, number][] = [
  ["M 60 30 Q 160 0 260 30", 0],
  ["M 60 98 Q 160 130 260 98", 0.6],
  ["M 60 30 L 60 98", 1.2],
  ["M 260 30 L 260 98", 1.8],
  ["M 60 30 L 260 98", 0.3],
  ["M 260 30 L 60 98", 0.9],
];

export function DistributedStorageCard() {
  return (
    <ArchitectureCardShell
      eyebrow="// storage-mesh"
      title="Distributed Storage"
      desc="Erasure-coded object storage replicated across continents with sub-10ms reads and zero data-loss guarantees."
    >
      <div className="relative h-32 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-3">
        <svg viewBox="0 0 320 128" className="h-full w-full" fill="none">
          <defs>
            <linearGradient id="repArc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(111,232,154,0)" />
              <stop offset="50%" stopColor="rgba(111,232,154,0.8)" />
              <stop offset="100%" stopColor="rgba(111,232,154,0)" />
            </linearGradient>
          </defs>

          {STORAGE_NODES.map((n, i) => (
            <g key={i}>
              <rect
                x={n.x - 36}
                y={n.y - 12}
                width="72"
                height="24"
                rx="6"
                fill="rgba(111,232,154,0.08)"
                stroke="rgba(111,232,154,0.45)"
              />
              <circle
                cx={n.x - 24}
                cy={n.y}
                r="3"
                fill="rgba(111,232,154,1)"
                className="animate-pulse-soft"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
              <text
                x={n.x + 4}
                y={n.y + 3}
                fontSize="8"
                fill="rgba(255,255,255,0.7)"
                fontFamily="monospace"
              >
                {n.label}
              </text>
            </g>
          ))}

          {STORAGE_LINKS.map(([d, delay], i) => (
            <g key={i}>
              <path
                d={d}
                stroke="rgba(111,232,154,0.18)"
                strokeWidth="0.7"
                fill="none"
              />
              <path
                d={d}
                stroke="url(#repArc)"
                strokeWidth="1.4"
                strokeDasharray="8 90"
                strokeLinecap="round"
                fill="none"
                className="animate-dash-flow"
                style={{ animationDelay: `${delay}s`, animationDuration: "4s" }}
              />
            </g>
          ))}
        </svg>
      </div>

      <ul className="mt-4 space-y-1.5 font-mono text-[11px] text-white/55">
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          11 nines durability (99.999999999%)
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          Reed-Solomon 8+4 erasure
        </li>
        <li className="flex items-center gap-2">
          <span className="h-1 w-1 rounded-full bg-basil-300" />
          Active-active across 4 regions
        </li>
      </ul>
    </ArchitectureCardShell>
  );
}
