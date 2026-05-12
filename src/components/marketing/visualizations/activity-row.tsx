import type { ActivityEvent, ActivityEventType } from "@/src/lib/marketing/activity";

type ActivityRowProps = {
  event: ActivityEvent;
  index: number;
};

const COLOR_MAP: Record<ActivityEventType, string> = {
  ok: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)] text-basil-200",
  info: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,1)] text-cyan-200",
  warn: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,1)] text-amber-200",
  secure:
    "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,1)] text-emerald-200",
  deploy:
    "bg-fuchsia-300 shadow-[0_0_10px_rgba(240,171,252,1)] text-fuchsia-200",
};

const TAG_MAP: Record<ActivityEventType, string> = {
  ok: "[OK]",
  info: "[INFO]",
  warn: "[HEAL]",
  secure: "[SEC]",
  deploy: "[DEPLOY]",
};

export function ActivityRow({ event, index }: ActivityRowProps) {
  const ts = `00:${String((index * 7) % 60).padStart(2, "0")}:${String(
    (index * 13) % 60,
  ).padStart(2, "0")}`;

  const dotClasses = COLOR_MAP[event.type].split(" ").slice(0, 2).join(" ");
  const textClass = COLOR_MAP[event.type].split(" ").pop() ?? "text-white";

  return (
    <div className="flex items-center gap-3 border-b border-white/[0.04] px-5 py-3 transition-colors duration-300 hover:bg-basil-400/[0.04]">
      <span className="text-[11px] tabular-nums text-white/30">{ts}</span>
      <span
        className={`relative inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses} animate-pulse-soft`}
      />
      <span className={`text-[10px] uppercase tracking-[0.18em] ${textClass}`}>
        {TAG_MAP[event.type]}
      </span>
      <span className="truncate text-white/85">{event.title}</span>
      <span className="ml-auto hidden truncate text-[11px] text-white/35 md:inline">
        {event.meta}
      </span>
    </div>
  );
}
