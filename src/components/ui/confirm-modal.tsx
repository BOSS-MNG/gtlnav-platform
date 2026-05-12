"use client";

import { useEffect } from "react";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy,
  destructive,
  error,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const accent = destructive
    ? "from-red-300 via-red-400 to-red-500"
    : "from-basil-300 via-basil-400 to-basil-500";
  const accentShadow = destructive
    ? "shadow-[0_0_30px_-8px_rgba(248,113,113,0.7)] hover:shadow-[0_0_45px_-5px_rgba(248,113,113,1)]"
    : "shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]";
  const accentRing = destructive ? "from-red-400/40" : "from-basil-400/40";
  const eyebrowColor = destructive ? "text-red-200/80" : "text-basil-300/80";
  const topLine = destructive ? "via-red-300/60" : "via-basil-300/60";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => {
          if (!busy) onClose();
        }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md">
        <div
          className={`pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br ${accentRing} via-white/5 to-transparent opacity-80 blur-md`}
        />
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-7 backdrop-blur-2xl">
          <div
            className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${topLine} to-transparent`}
          />

          <p
            className={`text-[10px] font-medium uppercase tracking-[0.28em] ${eyebrowColor}`}
          >
            {destructive ? "// danger-zone" : "// confirm"}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
            {title}
          </h2>
          {description ? (
            <p className="mt-2 text-sm text-white/60">{description}</p>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r ${accent} px-5 py-2 text-sm font-semibold text-black transition-all ${accentShadow} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
