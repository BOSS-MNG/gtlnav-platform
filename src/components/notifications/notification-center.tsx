"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/src/lib/supabase";
import {
  generateBurst,
  generateNotification,
  groupNotifications,
  highestSeverity,
  relativeTime,
  severityClass,
  unreadCount,
  NOTIFICATION_CATEGORY_META,
  type Notification,
} from "@/src/lib/notifications";
import { BellIcon } from "@/src/components/ui/icons";

const STORAGE_KEY = "gtlnav.notifications.v1";
const POLL_MS = 12_000;
const MAX_KEEP = 80;

type Stored = {
  userId: string;
  notifications: Notification[];
  updatedAt: string;
};

function readStore(userId: string): Notification[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.userId !== userId) return null;
    if (!Array.isArray(parsed.notifications)) return null;
    return parsed.notifications;
  } catch {
    return null;
  }
}

function writeStore(userId: string, notifications: Notification[]) {
  if (typeof window === "undefined") return;
  try {
    const payload: Stored = {
      userId,
      notifications: notifications.slice(0, MAX_KEEP),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* no-op */
  }
}

export type NotificationCenterProps = {
  /** When true, the operator-only template pool is also drawn. */
  operatorScope?: boolean;
  /** Anchor side. Kept for backwards compat; the panel now floats next to
   *  the bell so it never overlaps the sidebar. */
  align?: "right" | "left";
};

type PanelPos = { top: number; left: number; width: number; isMobile: boolean };

const PANEL_WIDTH = 400;
const PANEL_GUTTER = 12; // gap between bell and panel
const VIEWPORT_PAD = 12; // min distance from viewport edges

function computePanelPos(bell: HTMLElement | null): PanelPos {
  if (typeof window === "undefined" || !bell) {
    return { top: 12, left: 12, width: PANEL_WIDTH, isMobile: false };
  }
  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  if (isMobile) {
    return {
      top: 12,
      left: 12,
      width: Math.max(0, window.innerWidth - 24),
      isMobile: true,
    };
  }
  const rect = bell.getBoundingClientRect();
  // Prefer right of the bell; if it would overflow, flip to the left side.
  const w = PANEL_WIDTH;
  const right = rect.right + PANEL_GUTTER + w;
  let left = rect.right + PANEL_GUTTER;
  if (right > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, rect.left - PANEL_GUTTER - w);
  }
  // Anchor top to bell's top, but clamp to viewport.
  const maxTop = window.innerHeight - VIEWPORT_PAD - 200; // keep at least 200px visible
  const top = Math.min(Math.max(VIEWPORT_PAD, rect.top), Math.max(VIEWPORT_PAD, maxTop));
  return { top, left, width: w, isMobile: false };
}

export function NotificationCenter({
  operatorScope = false,
}: NotificationCenterProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos>({
    top: 12,
    left: 12,
    width: PANEL_WIDTH,
    isMobile: false,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Portal target only exists in the browser.
  useEffect(() => {
    setMounted(true);
  }, []);

  /* ----------------------- session bootstrap ----------------------- */
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      setUserId(s?.user?.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setUserId(newSession?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  /* ----------------------- load + persist -------------------------- */
  useEffect(() => {
    if (!userId) {
      setItems([]);
      setHydrated(true);
      return;
    }
    const cached = readStore(userId);
    if (cached && cached.length) {
      setItems(cached);
    } else {
      const seeded = generateBurst({
        userId,
        scope: operatorScope ? "operator" : "user",
        count: 10,
      });
      setItems(seeded);
      writeStore(userId, seeded);
    }
    setHydrated(true);
  }, [userId, operatorScope]);

  useEffect(() => {
    if (!userId || !hydrated) return;
    writeStore(userId, items);
  }, [userId, items, hydrated]);

  /* ----------------------- realtime sim ---------------------------- */
  useEffect(() => {
    if (!userId) return;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const chance = operatorScope ? 0.7 : 0.55;
      if (Math.random() > chance) return;
      const next = generateNotification({
        userId,
        scope: operatorScope ? "operator" : "user",
      });
      setItems((prev) => [next, ...prev].slice(0, MAX_KEEP));
    }, POLL_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [userId, operatorScope]);

  /* ----------------------- click outside / escape ------------------ */
  useEffect(() => {
    if (!open) return;
    function onClick(ev: MouseEvent) {
      const target = ev.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      // Panel is portaled to <body>; check it explicitly.
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* ----------------------- reposition while open ------------------- */
  useEffect(() => {
    if (!open) return;
    function update() {
      setPanelPos(computePanelPos(bellRef.current));
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Lock body scroll when the mobile full-screen panel is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!open) return;
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* ----------------------- actions --------------------------------- */
  const markAsRead = useCallback((id: string) => {
    const ts = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? ts } : n)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    const ts = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: ts })));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  /* ----------------------- derived data ---------------------------- */
  const unread = useMemo(() => unreadCount(items), [items]);
  const groups = useMemo(() => groupNotifications(items.slice(0, 30)), [items]);
  const overall = useMemo(
    () => (items.length ? highestSeverity(items) : "info"),
    [items],
  );
  const overallClass = severityClass(overall);

  if (!userId) {
    return null;
  }

  // Build the popover so we can portal it. Rendered ONLY when open.
  const popover =
    open && mounted && typeof document !== "undefined"
      ? createPortal(
          <>
            {/* Scrim — full-screen on mobile, transparent click-catcher on md+.
                Always on top of dashboard content via z-[9998]. */}
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
              className={
                panelPos.isMobile
                  ? "fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
                  : "fixed inset-0 z-[9998] bg-transparent"
              }
            />

            <div
              ref={panelRef}
              role="dialog"
              aria-label="Notifications"
              style={{
                position: "fixed",
                top: panelPos.top,
                left: panelPos.left,
                width: panelPos.width,
                zIndex: 9999,
                maxHeight: panelPos.isMobile
                  ? "85vh"
                  : "min(560px, calc(100vh - 24px))",
              }}
              className="overflow-hidden rounded-2xl border border-white/10 bg-black/90 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl"
            >
            <header className="flex items-center justify-between gap-2 border-b border-white/5 bg-gradient-to-r from-white/[0.04] to-transparent px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${overallClass.dot}`}
                />
                <span className="text-[11px] uppercase tracking-[0.2em] text-white/65">
                  {operatorScope ? "Operator alerts" : "Notifications"}
                </span>
                {unread > 0 ? (
                  <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/85">
                    {unread > 99 ? "99+" : unread} unread
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 transition hover:border-white/25 hover:text-white"
              >
                Close
              </button>
            </header>

            <div className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-2 text-[11px]">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unread === 0}
                className="rounded-md border border-white/10 px-2 py-1 text-white/70 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={items.length === 0}
                className="rounded-md border border-white/10 px-2 py-1 text-white/55 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>

            <ul className="max-h-[55vh] overflow-y-auto md:max-h-[420px]">
              {groups.length === 0 ? (
                <li className="px-4 py-12 text-center text-xs text-white/45">
                  <BellIcon className="mx-auto h-6 w-6 text-white/25" />
                  <p className="mt-3">No notifications yet.</p>
                  <p className="mt-1 text-[11px] text-white/35">
                    Deployments, DNS verifications, and operator alerts land here.
                  </p>
                </li>
              ) : (
                groups.map((group) => {
                  const sev = severityClass(group.severity);
                  const meta = NOTIFICATION_CATEGORY_META[group.category];
                  const hasUnread = group.unreadCount > 0;
                  return (
                    <li
                      key={group.key}
                      className={`relative border-b border-white/5 transition-colors ${
                        hasUnread ? "bg-white/[0.02]" : "bg-transparent"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full ${sev.bar} ${
                          hasUnread ? "opacity-90" : "opacity-30"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => markAsRead(group.latest.id)}
                        className="block w-full px-4 py-3 text-left transition hover:bg-white/[0.04]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
                              <span className={sev.text}>{sev.label}</span>
                              <span>·</span>
                              <span>{meta.short}</span>
                              {group.count > 1 ? (
                                <>
                                  <span>·</span>
                                  <span>{group.count} events</span>
                                </>
                              ) : null}
                            </div>
                            <h3 className="mt-1 truncate text-sm font-medium text-white">
                              {group.latest.title}
                            </h3>
                            <p className="mt-0.5 line-clamp-2 text-xs text-white/60">
                              {group.latest.body}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] text-white/35">
                              {relativeTime(group.latest.created_at)}
                            </p>
                            {hasUnread ? (
                              <span
                                aria-hidden
                                className={`mt-1 ml-auto block h-1.5 w-1.5 rounded-full ${sev.dot}`}
                              />
                            ) : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            <footer className="border-t border-white/5 bg-black/50 px-4 py-3">
              <Link
                href="/dashboard/notifications"
                onClick={() => setOpen(false)}
                className="inline-flex w-full items-center justify-between rounded-xl border border-basil-400/35 bg-basil-500/10 px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20"
              >
                <span>View all notifications</span>
                <span aria-hidden>→</span>
              </Link>
            </footer>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className={`group relative grid h-9 w-9 place-items-center rounded-xl border transition-colors ${
          unread > 0
            ? `${overallClass.ring} ${overallClass.text}`
            : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
        }`}
      >
        <BellIcon className="h-4 w-4" title="Notifications" />
        {unread > 0 ? (
          <>
            <span
              aria-hidden
              className={`pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${overallClass.dot} animate-pulse`}
            />
            <span className="absolute -bottom-1 -right-1 inline-flex min-w-[18px] items-center justify-center rounded-full border border-black/40 bg-black/80 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          </>
        ) : null}
      </button>
      {popover}
    </div>
  );
}
