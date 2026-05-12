export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export function shortTime(iso: string | null | undefined) {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function absoluteTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type StatusStyle = {
  dot: string;
  text: string;
  ring: string;
};

export function projectStatusStyle(status: string | null | undefined): StatusStyle {
  const s = (status ?? "active").toLowerCase();
  if (s === "active" || s === "running" || s === "online" || s === "ready") {
    return {
      dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.95)]",
      text: "text-basil-200",
      ring: "border-basil-400/40 bg-basil-500/10",
    };
  }
  if (s.includes("err") || s.includes("fail") || s.includes("crash")) {
    return {
      dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)] animate-pulse",
      text: "text-red-200",
      ring: "border-red-400/40 bg-red-500/10",
    };
  }
  if (s.includes("paused") || s.includes("idle") || s.includes("archived") || s.includes("stopped")) {
    return {
      dot: "bg-white/45",
      text: "text-white/65",
      ring: "border-white/15 bg-white/[0.04]",
    };
  }
  if (s === "deploying" || s.includes("rollout")) {
    return {
      dot: "bg-basil-300 shadow-[0_0_14px_rgba(111,232,154,1)] animate-pulse",
      text: "text-basil-200",
      ring: "border-basil-400/50 bg-basil-500/15",
    };
  }
  if (
    s === "building" ||
    s === "cloning" ||
    s === "installing" ||
    s === "optimizing"
  ) {
    return {
      dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)] animate-pulse",
      text: "text-cyan-200",
      ring: "border-cyan-400/40 bg-cyan-500/10",
    };
  }
  return {
    dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.95)] animate-pulse",
    text: "text-amber-200",
    ring: "border-amber-400/40 bg-amber-500/10",
  };
}

export function deploymentStatusStyle(
  status: string | null | undefined,
): StatusStyle & { tag: string } {
  const s = (status ?? "queued").toLowerCase();
  if (
    s === "active" ||
    s.includes("success") ||
    s.includes("ready") ||
    s.includes("complete")
  ) {
    return {
      dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,0.95)]",
      text: "text-basil-200",
      ring: "border-basil-400/40 bg-basil-500/10",
      tag: "ACTIVE",
    };
  }
  if (s.includes("err") || s.includes("fail") || s.includes("crash")) {
    return {
      dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.95)] animate-pulse",
      text: "text-red-200",
      ring: "border-red-400/40 bg-red-500/10",
      tag: "FAILED",
    };
  }
  if (s === "deploying" || s.includes("rollout")) {
    return {
      dot: "bg-basil-300 shadow-[0_0_14px_rgba(111,232,154,1)] animate-pulse",
      text: "text-basil-200",
      ring: "border-basil-400/50 bg-basil-500/15",
      tag: "DEPLOYING",
    };
  }
  if (
    s === "building" ||
    s === "cloning" ||
    s === "installing" ||
    s === "optimizing" ||
    s === "preparing" ||
    s.includes("build") ||
    s.includes("running")
  ) {
    return {
      dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.95)] animate-pulse",
      text: "text-cyan-200",
      ring: "border-cyan-400/40 bg-cyan-500/10",
      tag: s.toUpperCase(),
    };
  }
  if (s.includes("cancel")) {
    return {
      dot: "bg-white/40",
      text: "text-white/60",
      ring: "border-white/15 bg-white/[0.04]",
      tag: "CANCELED",
    };
  }
  if (s.includes("rollback") || s === "rolled_back") {
    return {
      dot: "bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.95)]",
      text: "text-violet-200",
      ring: "border-violet-400/40 bg-violet-500/10",
      tag: "ROLLED BACK",
    };
  }
  return {
    dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.95)] animate-pulse",
    text: "text-amber-200",
    ring: "border-amber-400/40 bg-amber-500/10",
    tag: "QUEUED",
  };
}

export function domainStatusStyle(
  status: string | null | undefined,
): StatusStyle {
  const s = (status ?? "pending").toLowerCase();
  if (s.includes("active") || s.includes("verified") || s.includes("ready")) {
    return {
      dot: "bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.9)]",
      text: "text-basil-200",
      ring: "border-basil-400/40 bg-basil-500/10",
    };
  }
  if (s.includes("err") || s.includes("fail")) {
    return {
      dot: "bg-red-400",
      text: "text-red-200",
      ring: "border-red-400/40 bg-red-500/10",
    };
  }
  return {
    dot: "bg-amber-300",
    text: "text-amber-200",
    ring: "border-amber-400/40 bg-amber-500/10",
  };
}

export function logLevelClasses(level: string | null | undefined) {
  const v = (level ?? "info").toLowerCase();
  if (v.includes("error") || v.includes("fail") || v.includes("crit"))
    return {
      dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,1)]",
      label: "text-red-200",
      tag: "[ERR]",
    };
  if (v.includes("warn"))
    return {
      dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,1)]",
      label: "text-amber-200",
      tag: "[WARN]",
    };
  if (v.includes("deploy"))
    return {
      dot: "bg-fuchsia-300 shadow-[0_0_10px_rgba(240,171,252,1)]",
      label: "text-fuchsia-200",
      tag: "[DEPLOY]",
    };
  if (v.includes("sec") || v.includes("ssl") || v.includes("auth"))
    return {
      dot: "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,1)]",
      label: "text-emerald-200",
      tag: "[SEC]",
    };
  if (v === "info" || v.includes("ok") || v.includes("success"))
    return {
      dot: "bg-basil-300 shadow-[0_0_10px_rgba(111,232,154,1)]",
      label: "text-basil-200",
      tag: `[${v.toUpperCase()}]`,
    };
  return {
    dot: "bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,1)]",
    label: "text-cyan-200",
    tag: `[${v.toUpperCase() || "INFO"}]`,
  };
}

export type LogLike = {
  message?: string | null;
  level?: string | null;
  severity?: string | null;
  type?: string | null;
  event_type?: string | null;
  event?: unknown;
  source?: string | null;
};

export function logLevel(log: LogLike): string {
  return (
    log.severity ??
    log.level ??
    log.event_type ??
    log.type ??
    "info"
  ).toString();
}

export function logTag(log: LogLike): string {
  const eventType = log.event_type ?? log.type;
  if (typeof eventType === "string" && eventType.length > 0) {
    return `[${eventType.toUpperCase()}]`;
  }
  return logLevelClasses(logLevel(log)).tag;
}

export function logMessage(log: LogLike): string {
  if (typeof log.message === "string" && log.message.length > 0) {
    return log.message;
  }
  if (typeof log.event === "string" && log.event.length > 0) {
    return log.event;
  }
  if (typeof log.event_type === "string" && log.event_type.length > 0) {
    return log.event_type;
  }
  return "Event";
}
