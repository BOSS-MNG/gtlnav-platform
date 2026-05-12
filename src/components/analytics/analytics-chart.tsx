"use client";

import { useId, useMemo, useState } from "react";
import {
  buildSmoothArea,
  buildSmoothPath,
  humanizeNumber,
  normalizeSeries,
  type SeriesPoint,
} from "@/src/lib/analytics-simulator";

export type ChartTone =
  | "basil"
  | "cyan"
  | "amber"
  | "rose"
  | "violet"
  | "white";

const TONE_PRIMARY: Record<ChartTone, string> = {
  basil: "#7DE7A4",
  cyan: "#67E8F9",
  amber: "#FCD34D",
  rose: "#FB7185",
  violet: "#C4B5FD",
  white: "#F1F5F9",
};

const TONE_SHADOW: Record<ChartTone, string> = {
  basil: "rgba(125,231,164,0.45)",
  cyan: "rgba(103,232,249,0.45)",
  amber: "rgba(252,211,77,0.45)",
  rose: "rgba(251,113,133,0.45)",
  violet: "rgba(196,181,253,0.45)",
  white: "rgba(241,245,249,0.35)",
};

export type ChartSeries = {
  id: string;
  label: string;
  tone: ChartTone;
  data: SeriesPoint[];
  /** Format the value for tooltip display (overrides default humanizeNumber). */
  format?: (value: number) => string;
  /** When true, this series is rendered as filled area (default). When false,
   *  it's rendered as a thin line. */
  area?: boolean;
};

export type AnalyticsChartProps = {
  series: ChartSeries[];
  height?: number;
  /** When true, shows axis grid lines and labels. */
  showAxes?: boolean;
  /** Optional callout to show in the empty state. */
  emptyLabel?: string;
};

const VIEW_W = 1000;
const VIEW_H = 320;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 24;

export function AnalyticsChart({
  series,
  height = 320,
  showAxes = true,
  emptyLabel = "No data yet",
}: AnalyticsChartProps) {
  const uid = useId().replace(/[:]/g, "");
  const [hover, setHover] = useState<{ idx: number; x: number } | null>(null);

  const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM;

  const normalized = useMemo(() => {
    return series
      .filter((s) => s.data.length > 0)
      .map((s) => ({
        ...s,
        norm: normalizeSeries(s.data),
      }));
  }, [series]);

  if (normalized.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center"
        style={{ height }}
      >
        <p className="text-xs uppercase tracking-[0.24em] text-white/45">
          {emptyLabel}
        </p>
      </div>
    );
  }

  // Use longest series for x-axis labelling.
  const longest = normalized.reduce((acc, s) =>
    s.data.length > acc.data.length ? s : acc,
  );

  const buckets = longest.data.length;
  const tickIdxs = pickTicks(buckets, 6);

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40"
      style={{ height }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
        role="img"
        aria-label="Analytics chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const xViewPort = ratio * VIEW_W;
          if (xViewPort < PAD_LEFT || xViewPort > VIEW_W - PAD_RIGHT) {
            setHover(null);
            return;
          }
          const innerRatio = (xViewPort - PAD_LEFT) / innerW;
          const idx = Math.round(innerRatio * (buckets - 1));
          setHover({ idx, x: xViewPort });
        }}
      >
        {/* gradients */}
        <defs>
          {normalized.map((s) => (
            <linearGradient
              key={s.id}
              id={`grad-${uid}-${s.id}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={TONE_PRIMARY[s.tone]} stopOpacity={0.45} />
              <stop offset="100%" stopColor={TONE_PRIMARY[s.tone]} stopOpacity={0} />
            </linearGradient>
          ))}
          <linearGradient id={`scan-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.18)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {/* grid */}
        {showAxes ? (
          <g>
            {[0, 0.25, 0.5, 0.75, 1].map((g) => (
              <line
                key={g}
                x1={PAD_LEFT}
                y1={PAD_TOP + g * innerH}
                x2={VIEW_W - PAD_RIGHT}
                y2={PAD_TOP + g * innerH}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
            ))}
          </g>
        ) : null}

        {/* y-axis labels (use longest series scale) */}
        {showAxes ? (
          <g fill="rgba(255,255,255,0.45)" fontSize={10} fontFamily="monospace">
            {[1, 0.75, 0.5, 0.25, 0].map((g, i) => {
              const v =
                longest.norm.min + (longest.norm.max - longest.norm.min) * g;
              return (
                <text
                  key={i}
                  x={PAD_LEFT - 6}
                  y={PAD_TOP + (1 - g) * innerH + 3}
                  textAnchor="end"
                >
                  {(longest.format ?? humanizeNumber)(v)}
                </text>
              );
            })}
          </g>
        ) : null}

        {/* x-axis labels */}
        {showAxes ? (
          <g fill="rgba(255,255,255,0.4)" fontSize={10} fontFamily="monospace">
            {tickIdxs.map((idx) => {
              const ratio = idx / Math.max(1, buckets - 1);
              const x = PAD_LEFT + ratio * innerW;
              const label = formatTick(longest.data[idx]?.t);
              return (
                <text
                  key={idx}
                  x={x}
                  y={VIEW_H - 6}
                  textAnchor="middle"
                  opacity={0.7}
                >
                  {label}
                </text>
              );
            })}
          </g>
        ) : null}

        {/* series */}
        <g transform={`translate(${PAD_LEFT}, ${PAD_TOP})`}>
          {normalized.map((s) => {
            const renderArea = s.area !== false;
            return (
              <g key={s.id}>
                {renderArea ? (
                  <path
                    d={buildSmoothArea(s.norm.points, innerW, innerH)}
                    fill={`url(#grad-${uid}-${s.id})`}
                    opacity={0.85}
                  />
                ) : null}
                <path
                  d={buildSmoothPath(s.norm.points, innerW, innerH)}
                  fill="none"
                  stroke={TONE_PRIMARY[s.tone]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    filter: `drop-shadow(0 0 6px ${TONE_SHADOW[s.tone]})`,
                  }}
                />
              </g>
            );
          })}
        </g>

        {/* hover crosshair */}
        {hover ? (
          <g>
            <line
              x1={hover.x}
              y1={PAD_TOP}
              x2={hover.x}
              y2={VIEW_H - PAD_BOTTOM}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {normalized.map((s) => {
              const idx = clampIdx(hover.idx, s.norm.points.length);
              const point = s.norm.points[idx];
              if (!point) return null;
              const cx = PAD_LEFT + point.x * innerW;
              const cy = PAD_TOP + point.y * innerH;
              return (
                <g key={s.id}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5}
                    fill="black"
                    stroke={TONE_PRIMARY[s.tone]}
                    strokeWidth={2}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={9}
                    fill="none"
                    stroke={TONE_PRIMARY[s.tone]}
                    strokeOpacity={0.4}
                    strokeWidth={1}
                  />
                </g>
              );
            })}
          </g>
        ) : null}

        {/* sweep highlight (subtle) */}
        <rect
          x={0}
          y={0}
          width={VIEW_W}
          height={VIEW_H}
          fill={`url(#scan-${uid})`}
          opacity={0.12}
          pointerEvents="none"
        />
      </svg>

      {/* tooltip */}
      {hover ? (
        <Tooltip
          x={hover.x}
          series={normalized}
          idx={hover.idx}
        />
      ) : null}

      {/* legend */}
      {series.length > 1 ? (
        <div className="absolute right-3 top-3 flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1 backdrop-blur">
          {series.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-white/70"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: TONE_PRIMARY[s.tone],
                  boxShadow: `0 0 10px ${TONE_SHADOW[s.tone]}`,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type NormalizedSeries = ChartSeries & {
  norm: ReturnType<typeof normalizeSeries>;
};

function Tooltip({
  x,
  series,
  idx,
}: {
  x: number;
  series: NormalizedSeries[];
  idx: number;
}) {
  // Position the tooltip in container coordinates. We use percentage based
  // on the viewBox width so it tracks the SVG.
  const pct = (x / VIEW_W) * 100;
  const left = pct > 70 ? `calc(${pct}% - 220px)` : `calc(${pct}% + 12px)`;
  const ts =
    series[0]?.norm.points[clampIdx(idx, series[0].norm.points.length)]?.raw.t;
  return (
    <div
      className="pointer-events-none absolute top-4 z-10 min-w-[200px] rounded-2xl border border-white/10 bg-black/85 p-3 backdrop-blur"
      style={{ left }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">
        {formatTimestamp(ts)}
      </p>
      <ul className="mt-2 space-y-1.5">
        {series.map((s) => {
          const point = s.norm.points[clampIdx(idx, s.norm.points.length)];
          if (!point) return null;
          const formatted = (s.format ?? humanizeNumber)(point.raw.value);
          return (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <span className="inline-flex items-center gap-1.5 text-white/70">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: TONE_PRIMARY[s.tone],
                    boxShadow: `0 0 10px ${TONE_SHADOW[s.tone]}`,
                  }}
                />
                {s.label}
              </span>
              <span className="font-mono font-semibold text-white">
                {formatted}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function clampIdx(idx: number, len: number) {
  if (len === 0) return 0;
  return Math.max(0, Math.min(len - 1, idx));
}

function pickTicks(buckets: number, count: number): number[] {
  if (buckets <= count) return Array.from({ length: buckets }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Math.round((i / (count - 1)) * (buckets - 1)));
  }
  return out;
}

function formatTick(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
