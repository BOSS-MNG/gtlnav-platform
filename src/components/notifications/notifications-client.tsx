"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { BellIcon } from "@/src/components/ui/icons";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  absoluteTime,
  compareSeverity,
  defaultPreferences,
  generateBurst,
  generateNotification,
  groupNotifications,
  highestSeverity,
  planChannelDispatch,
  relativeTime,
  severityClass,
  unreadCount,
  type Notification,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDigestFrequency,
  type NotificationPreferences,
  type NotificationSeverity,
} from "@/src/lib/notifications";

const STORAGE_KEY = "gtlnav.notifications.v1";
const PREFS_KEY = "gtlnav.notification_prefs.v1";
const POLL_MS = 9_000;
const MAX_KEEP = 200;

type LoadState = "loading" | "ready" | "redirect";

type Toast = { tone: "success" | "error" | "info"; text: string } | null;

type Filter = "all" | "unread" | NotificationCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  ...NOTIFICATION_CATEGORIES.map((c) => ({
    id: c as Filter,
    label: NOTIFICATION_CATEGORY_META[c].short,
  })),
];

const DIGEST_OPTIONS: NotificationDigestFrequency[] = [
  "instant",
  "daily",
  "weekly",
  "off",
];

// ---------------------------------------------------------------------------
//  storage helpers
// ---------------------------------------------------------------------------

function readNotifications(userId: string): Notification[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId: string; notifications: Notification[] };
    if (parsed.userId !== userId) return null;
    return Array.isArray(parsed.notifications) ? parsed.notifications : null;
  } catch {
    return null;
  }
}

function writeNotifications(userId: string, items: Notification[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId,
        notifications: items.slice(0, MAX_KEEP),
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* no-op */
  }
}

function readPrefs(userId: string): NotificationPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotificationPreferences;
    if (parsed.user_id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePrefs(prefs: NotificationPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
//  Main client
// ---------------------------------------------------------------------------

export default function NotificationsClient() {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<Toast>(null);
  const [livePaused, setLivePaused] = useState(false);
  const tickRef = useRef<number | null>(null);

  const flashToast = useCallback((tone: NonNullable<Toast>["tone"], text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  // ----- Auth bootstrap --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/notifications");
        return;
      }
      setSession(data.session);
      setLoadState("ready");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      if (!next) {
        setLoadState("redirect");
        router.replace("/login?next=/dashboard/notifications");
        return;
      }
      setSession(next);
    });
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [router]);

  // ----- Load + persist notifications ------------------------------------
  useEffect(() => {
    if (!session) return;
    const cached = readNotifications(session.user.id);
    if (cached && cached.length > 0) {
      setItems(cached);
    } else {
      const seeded = generateBurst({
        userId: session.user.id,
        scope: "user",
        count: 22,
      });
      setItems(seeded);
      writeNotifications(session.user.id, seeded);
    }

    const cachedPrefs = readPrefs(session.user.id);
    if (cachedPrefs) {
      setPrefs(cachedPrefs);
    } else {
      const fresh = defaultPreferences(session.user.id, session.user.email ?? null);
      setPrefs(fresh);
      writePrefs(fresh);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    writeNotifications(session.user.id, items);
  }, [session, items]);

  useEffect(() => {
    if (!prefs) return;
    writePrefs(prefs);
  }, [prefs]);

  // ----- Realtime simulation --------------------------------------------
  useEffect(() => {
    if (!session) return;
    if (livePaused) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => {
      if (Math.random() > 0.55) return;
      const next = generateNotification({
        userId: session.user.id,
        scope: "user",
      });
      setItems((prev) => [next, ...prev].slice(0, MAX_KEEP));
    }, POLL_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [session, livePaused]);

  // ----- Actions ---------------------------------------------------------
  const markAsRead = useCallback((id: string) => {
    const ts = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? ts } : n)),
    );
  }, []);

  const markGroupRead = useCallback((groupKey: string) => {
    const ts = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => {
        const key = n.group_key ?? `${n.category}:${n.title}`;
        return key === groupKey ? { ...n, read_at: n.read_at ?? ts } : n;
      }),
    );
  }, []);

  const markAllRead = useCallback(() => {
    const ts = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: ts })));
    flashToast("success", "All notifications marked read.");
  }, [flashToast]);

  const clearAll = useCallback(() => {
    setItems([]);
    flashToast("info", "Notification feed cleared.");
  }, [flashToast]);

  const injectTest = useCallback(() => {
    if (!session) return;
    const next = generateNotification({ userId: session.user.id, scope: "user" });
    setItems((prev) => [next, ...prev].slice(0, MAX_KEEP));
    flashToast("info", `Injected ${next.category} alert.`);
  }, [session, flashToast]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  // ----- Derived ---------------------------------------------------------
  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => !n.read_at);
    return items.filter((n) => n.category === filter);
  }, [items, filter]);

  const groups = useMemo(() => groupNotifications(filtered), [filtered]);
  const unread = useMemo(() => unreadCount(items), [items]);
  const overall = useMemo<NotificationSeverity>(
    () => (items.length ? highestSeverity(items) : "info"),
    [items],
  );
  const overallStyle = severityClass(overall);

  const counts = useMemo(() => {
    const map: Record<NotificationCategory, number> = {} as Record<
      NotificationCategory,
      number
    >;
    for (const c of NOTIFICATION_CATEGORIES) map[c] = 0;
    for (const n of items) map[n.category] += 1;
    return map;
  }, [items]);

  const incidentFeed = useMemo(
    () =>
      items
        .filter((n) => compareSeverity(n.severity, "warn") >= 0)
        .slice(0, 12),
    [items],
  );

  if (loadState === "loading") {
    return <FullPageMessage label="Verifying session…" />;
  }
  if (loadState === "redirect" || !session || !prefs) {
    return <FullPageMessage label="Redirecting to sign in…" />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[60] max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${
            toast.tone === "success"
              ? "border-basil-400/40 bg-basil-500/15 text-basil-50"
              : toast.tone === "error"
                ? "border-red-400/40 bg-red-500/15 text-red-100"
                : "border-white/15 bg-white/[0.08] text-white/90"
          }`}
        >
          {toast.text}
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar
          activeKey="settings"
          userEmail={session.user.email}
        />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          {/* HEADER */}
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.32em] text-basil-300/80">
                // notifications & alerts
              </p>
              <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                <span
                  className={`relative grid h-10 w-10 place-items-center rounded-2xl border ${overallStyle.ring} ${overallStyle.text}`}
                >
                  <BellIcon className="h-5 w-5" title="Notifications" />
                  {unread > 0 ? (
                    <span
                      aria-hidden
                      className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ${overallStyle.dot} animate-pulse`}
                    />
                  ) : null}
                </span>
                Notification center
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/55">
                Live operator-style feed for deployments, SSL, DNS, webhooks,
                usage, billing, and infrastructure events. In-app delivery is
                wired today; email and webhook channels are architectural
                stubs that respect your preferences below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LiveIndicator paused={livePaused} severity={overall} />
              <button
                type="button"
                onClick={() => setLivePaused((v) => !v)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                {livePaused ? "Resume live feed" : "Pause live feed"}
              </button>
              <button
                type="button"
                onClick={injectTest}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-basil-400/40 hover:text-white"
              >
                Inject test alert
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-red-400/30 hover:text-red-200"
              >
                Sign out
              </button>
            </div>
          </header>

          {/* SUMMARY */}
          <SummaryStrip
            unread={unread}
            total={items.length}
            overall={overall}
            counts={counts}
          />

          {/* MAIN GRID */}
          <section className="mt-8 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <FeedCard
              groups={groups}
              filter={filter}
              filters={FILTERS}
              filterCounts={counts}
              unread={unread}
              total={items.length}
              onFilterChange={setFilter}
              onMarkAllRead={markAllRead}
              onClear={clearAll}
              onMarkRead={markAsRead}
              onMarkGroupRead={markGroupRead}
            />
            <IncidentFeed items={incidentFeed} />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <ChannelPreferences
              prefs={prefs}
              onPrefsChange={setPrefs}
              onSaved={() => flashToast("success", "Preferences updated.")}
            />
            <CategoryMatrix prefs={prefs} onPrefsChange={setPrefs} />
          </section>

          <section className="mt-6">
            <DispatchPreview prefs={prefs} />
          </section>

          <section className="mt-6">
            <SchemaSetupCard />
          </section>

          <footer className="mt-10 border-t border-white/5 pt-5 text-[10px] uppercase tracking-[0.2em] text-white/35">
            // GTLNAV alerts pipeline · in-app live · email + webhook channels staged
          </footer>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({
  unread,
  total,
  overall,
  counts,
}: {
  unread: number;
  total: number;
  overall: NotificationSeverity;
  counts: Record<NotificationCategory, number>;
}) {
  const sev = severityClass(overall);
  const top = NOTIFICATION_CATEGORIES.map((c) => ({
    cat: c,
    count: counts[c],
    label: NOTIFICATION_CATEGORY_META[c].short,
  }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return (
    <section className="mt-6 grid gap-3 md:grid-cols-4">
      <Tile
        label="Unread"
        value={String(unread)}
        sub={`of ${total} total`}
        accent={sev}
      />
      <Tile
        label="Highest severity"
        value={sev.label}
        sub="across feed"
        accent={sev}
        accentText
      />
      <Tile
        label="Categories firing"
        value={String(top.length)}
        sub={top.map((t) => t.label).join(" · ") || "none"}
      />
      <Tile
        label="Live feed"
        value="On"
        sub="poll · 9s"
        accent={severityClass("success")}
      />
    </section>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
  accentText,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: ReturnType<typeof severityClass>;
  accentText?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
        {label}
      </p>
      <div className="mt-1 flex items-end gap-2">
        <p
          className={`text-2xl font-semibold ${
            accentText && accent ? accent.text : "text-white"
          }`}
        >
          {value}
        </p>
        {accent ? (
          <span
            aria-hidden
            className={`mb-1 inline-block h-2 w-2 rounded-full ${accent.dot}`}
          />
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-white/45">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Feed
// ---------------------------------------------------------------------------

type FeedCardProps = {
  groups: ReturnType<typeof groupNotifications>;
  filter: Filter;
  filters: { id: Filter; label: string }[];
  filterCounts: Record<NotificationCategory, number>;
  unread: number;
  total: number;
  onFilterChange: (f: Filter) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  onMarkRead: (id: string) => void;
  onMarkGroupRead: (groupKey: string) => void;
};

function FeedCard(props: FeedCardProps) {
  const {
    groups,
    filter,
    filters,
    filterCounts,
    unread,
    total,
    onFilterChange,
    onMarkAllRead,
    onClear,
    onMarkRead,
    onMarkGroupRead,
  } = props;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            // realtime feed
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Inbox</h2>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={unread === 0}
            className="rounded-md border border-white/10 px-2.5 py-1 text-white/70 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={total === 0}
            className="rounded-md border border-white/10 px-2.5 py-1 text-white/55 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear feed
          </button>
        </div>
      </header>

      <div className="flex gap-1.5 overflow-x-auto border-b border-white/5 px-3 py-2">
        {filters.map((f) => {
          const active = filter === f.id;
          let badge = "";
          if (f.id === "all") badge = String(total);
          else if (f.id === "unread") badge = String(unread);
          else badge = String(filterCounts[f.id as NotificationCategory] ?? 0);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              className={`group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
                active
                  ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
                  : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white"
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                  active
                    ? "bg-basil-500/20 text-basil-100"
                    : "bg-white/5 text-white/55 group-hover:text-white/80"
                }`}
              >
                {badge}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="max-h-[640px] divide-y divide-white/5 overflow-y-auto">
        {groups.length === 0 ? (
          <li className="px-6 py-16 text-center text-sm text-white/45">
            No matching notifications.
          </li>
        ) : (
          groups.map((g) => (
            <FeedRow
              key={g.key}
              group={g}
              onMarkRead={onMarkRead}
              onMarkGroupRead={onMarkGroupRead}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function FeedRow({
  group,
  onMarkRead,
  onMarkGroupRead,
}: {
  group: ReturnType<typeof groupNotifications>[number];
  onMarkRead: (id: string) => void;
  onMarkGroupRead: (groupKey: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sev = severityClass(group.severity);
  const meta = NOTIFICATION_CATEGORY_META[group.category];
  const hasUnread = group.unreadCount > 0;
  const collapsed = group.count > 1;

  return (
    <li
      className={`relative px-5 py-4 transition-colors ${
        hasUnread ? "bg-white/[0.02]" : "bg-transparent"
      }`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-full ${sev.bar} ${
          hasUnread ? "opacity-95" : "opacity-30"
        }`}
      />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
            <span className={sev.text}>{sev.label}</span>
            <span>·</span>
            <span>{meta.label}</span>
            {collapsed ? (
              <>
                <span>·</span>
                <span>{group.count} events grouped</span>
              </>
            ) : null}
            {group.latest.source !== meta.source ? (
              <>
                <span>·</span>
                <span>{group.latest.source}</span>
              </>
            ) : null}
          </div>
          <h3 className="mt-1 text-sm font-medium text-white">{group.latest.title}</h3>
          <p className="mt-0.5 text-xs text-white/65">{group.latest.body}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/35">
            <span>{relativeTime(group.latest.created_at)}</span>
            <span>·</span>
            <span>{absoluteTime(group.latest.created_at)}</span>
            {group.latest.href ? (
              <>
                <span>·</span>
                <Link
                  href={group.latest.href}
                  className="text-basil-300 hover:text-basil-100"
                >
                  Open →
                </Link>
              </>
            ) : null}
          </div>

          {expanded && collapsed ? (
            <ul className="mt-3 space-y-1 border-l border-white/10 pl-3 text-[11px] text-white/60">
              {group.items.slice(0, 6).map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{n.body}</span>
                  <span className="shrink-0 text-white/40">
                    {relativeTime(n.created_at)}
                  </span>
                </li>
              ))}
              {group.items.length > 6 ? (
                <li className="text-white/40">
                  + {group.items.length - 6} more in this group
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 text-[11px]">
          {hasUnread ? (
            <button
              type="button"
              onClick={() =>
                collapsed ? onMarkGroupRead(group.key) : onMarkRead(group.latest.id)
              }
              className="rounded-md border border-white/10 px-2 py-1 text-white/70 transition hover:border-white/20 hover:text-white"
            >
              Mark read
            </button>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">
              read
            </span>
          )}
          {collapsed ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md border border-white/10 px-2 py-1 text-white/55 transition hover:border-white/20 hover:text-white"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
//  Operator-style incident feed
// ---------------------------------------------------------------------------

function IncidentFeed({ items }: { items: Notification[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur">
      <header className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-rose-200/70">
            // operator incident feed
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Active incidents</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/55">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-300 shadow-[0_0_8px_rgba(251,113,133,1)]" />
          warn+
        </span>
      </header>
      <ol className="font-mono text-[12px]">
        {items.length === 0 ? (
          <li className="px-5 py-10 text-center text-xs text-white/45">
            No incidents — all systems nominal.
          </li>
        ) : (
          items.map((n) => {
            const sev = severityClass(n.severity);
            return (
              <li
                key={n.id}
                className="flex items-start gap-3 border-b border-white/5 px-5 py-2.5 last:border-b-0"
              >
                <span className="shrink-0 text-white/30">
                  {absoluteTime(n.created_at)}
                </span>
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] ${sev.text}`}
                >
                  {sev.label}
                </span>
                <span className="shrink-0 text-white/45">
                  [{NOTIFICATION_CATEGORY_META[n.category].short}]
                </span>
                <span className="min-w-0 flex-1 text-white/80">
                  <span className="text-white">{n.title}</span>{" "}
                  <span className="text-white/55">— {n.body}</span>
                </span>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Channel preferences
// ---------------------------------------------------------------------------

function ChannelPreferences({
  prefs,
  onPrefsChange,
  onSaved,
}: {
  prefs: NotificationPreferences;
  onPrefsChange: (p: NotificationPreferences) => void;
  onSaved: () => void;
}) {
  const [emailDraft, setEmailDraft] = useState(prefs.email_address ?? "");
  const [webhookDraft, setWebhookDraft] = useState(prefs.webhook_url ?? "");

  useEffect(() => {
    setEmailDraft(prefs.email_address ?? "");
  }, [prefs.email_address]);
  useEffect(() => {
    setWebhookDraft(prefs.webhook_url ?? "");
  }, [prefs.webhook_url]);

  function handleSave(ev: FormEvent) {
    ev.preventDefault();
    onPrefsChange({
      ...prefs,
      email_address: emailDraft.trim() || null,
      webhook_url: webhookDraft.trim() || null,
      updated_at: new Date().toISOString(),
    });
    onSaved();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            // channels
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Delivery channels</h2>
          <p className="mt-1 max-w-md text-xs text-white/55">
            In-app delivery is live. Email and webhook are architecture-only —
            preferences below feed the dispatch planner and a future server
            worker.
          </p>
        </div>
      </header>

      <form onSubmit={handleSave} className="mt-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <ChannelToggleCard
            channel="email"
            label="Email"
            sub="Operator-friendly digest. Schema only."
            enabled={prefs.email_enabled}
            onToggle={(v) =>
              onPrefsChange({ ...prefs, email_enabled: v, updated_at: new Date().toISOString() })
            }
          >
            <label className="mt-3 block text-[10px] uppercase tracking-[0.2em] text-white/40">
              Address
            </label>
            <input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="ops@yourdomain.com"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
            />
          </ChannelToggleCard>
          <ChannelToggleCard
            channel="webhook"
            label="Webhook"
            sub="POST signed events to your endpoint."
            enabled={prefs.webhook_enabled}
            onToggle={(v) =>
              onPrefsChange({ ...prefs, webhook_enabled: v, updated_at: new Date().toISOString() })
            }
          >
            <label className="mt-3 block text-[10px] uppercase tracking-[0.2em] text-white/40">
              URL
            </label>
            <input
              type="url"
              value={webhookDraft}
              onChange={(e) => setWebhookDraft(e.target.value)}
              placeholder="https://hooks.example.com/gtlnav"
              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none transition focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20"
            />
          </ChannelToggleCard>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            Digest frequency
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIGEST_OPTIONS.map((d) => {
              const active = prefs.digest_frequency === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    onPrefsChange({
                      ...prefs,
                      digest_frequency: d,
                      updated_at: new Date().toISOString(),
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition ${
                    active
                      ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
                      : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-white/40">
            Email + webhook fire only when digest is{" "}
            <span className="text-white/70">instant</span>. Daily / weekly digests
            roll up via a future server worker.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-full border border-basil-400/40 bg-basil-500/15 px-5 py-2 text-xs font-medium text-basil-50 transition hover:bg-basil-500/25"
          >
            Save preferences
          </button>
        </div>
      </form>
    </div>
  );
}

function ChannelToggleCard({
  channel,
  label,
  sub,
  enabled,
  onToggle,
  children,
}: {
  channel: NotificationChannel;
  label: string;
  sub: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            {channel}
          </p>
          <p className="mt-0.5 text-sm font-medium text-white">{label}</p>
          <p className="mt-0.5 text-[11px] text-white/55">{sub}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} ariaLabel={`Toggle ${label}`} />
      </div>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? "border-basil-400/40 bg-basil-500/40"
          : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full transition-transform ${
          checked
            ? "translate-x-[18px] bg-basil-100 shadow-[0_0_6px_rgba(111,232,154,0.7)]"
            : "translate-x-[3px] bg-white/55"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Per-category matrix
// ---------------------------------------------------------------------------

function CategoryMatrix({
  prefs,
  onPrefsChange,
}: {
  prefs: NotificationPreferences;
  onPrefsChange: (p: NotificationPreferences) => void;
}) {
  function toggle(c: NotificationCategory, ch: NotificationChannel, v: boolean) {
    const cats = { ...prefs.categories };
    cats[c] = { ...cats[c], [ch]: v };
    onPrefsChange({ ...prefs, categories: cats, updated_at: new Date().toISOString() });
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            // matrix
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Per-category routing</h2>
          <p className="mt-1 max-w-md text-xs text-white/55">
            Choose which channels each category fires on. Operator alerts ignore
            user routing — they always reach the admin console.
          </p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.2em] text-white/45">
            <tr>
              <th className="px-5 py-3 text-left">Category</th>
              <th className="px-3 py-3 text-center">In-app</th>
              <th className="px-3 py-3 text-center">Email</th>
              <th className="px-5 py-3 text-center">Webhook</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {NOTIFICATION_CATEGORIES.map((c) => {
              const meta = NOTIFICATION_CATEGORY_META[c];
              const sev = severityClass(meta.defaultSeverity);
              const cat = prefs.categories[c];
              const operatorOnly = c === "operator";
              return (
                <tr key={c} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${sev.dot}`}
                      />
                      <div>
                        <p className="text-white">{meta.label}</p>
                        <p className="text-[10px] text-white/40">{meta.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Toggle
                      checked={cat.in_app && !operatorOnly}
                      onChange={(v) => !operatorOnly && toggle(c, "in_app", v)}
                      ariaLabel={`${meta.label} in-app`}
                    />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <Toggle
                      checked={cat.email}
                      onChange={(v) => toggle(c, "email", v)}
                      ariaLabel={`${meta.label} email`}
                    />
                  </td>
                  <td className="px-5 py-3 text-center">
                    <Toggle
                      checked={cat.webhook}
                      onChange={(v) => toggle(c, "webhook", v)}
                      ariaLabel={`${meta.label} webhook`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Dispatch preview
// ---------------------------------------------------------------------------

function DispatchPreview({ prefs }: { prefs: NotificationPreferences }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            // dispatch planner
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Channel dispatch preview</h2>
          <p className="mt-1 max-w-2xl text-xs text-white/55">
            Pure-function preview of how a sample event from each category
            would route under your current preferences. The same{" "}
            <code className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px]">
              planChannelDispatch()
            </code>{" "}
            runs server-side once dispatch goes live.
          </p>
        </div>
      </header>
      <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
        {NOTIFICATION_CATEGORIES.map((c) => {
          const meta = NOTIFICATION_CATEGORY_META[c];
          const sample = { category: c, severity: meta.defaultSeverity };
          const plans = planChannelDispatch(sample, prefs);
          const sev = severityClass(meta.defaultSeverity);
          return (
            <div
              key={c}
              className="rounded-xl border border-white/10 bg-black/30 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                    {meta.short}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-white">{meta.label}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${sev.ring} ${sev.text}`}
                >
                  {sev.label}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-[11px]">
                {plans.map((p) => (
                  <li
                    key={p.channel}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-white/65">{p.channel}</span>
                    <span
                      className={`inline-flex items-center gap-1.5 ${
                        p.willSend ? "text-basil-200" : "text-white/40"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${
                          p.willSend
                            ? "bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,0.95)]"
                            : "bg-white/25"
                        }`}
                      />
                      {p.willSend ? "fire" : p.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Schema setup card
// ---------------------------------------------------------------------------

const NOTIFICATIONS_SQL = `-- GTLNAV — Notifications & Alerts (Phase 4F)

create table if not exists public.notifications (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null,
  severity     text not null,
  title        text not null,
  body         text not null,
  href         text,
  group_key    text,
  source       text not null,
  metadata     jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at)
  where read_at is null;

alter table public.notifications enable row level security;

create policy "notifications_owner_select"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "notifications_owner_update"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notifications_owner_delete"
  on public.notifications for delete
  using (auth.uid() = user_id);

create table if not exists public.notification_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  email_enabled    boolean not null default true,
  email_address    text,
  webhook_enabled  boolean not null default false,
  webhook_url      text,
  digest_frequency text not null default 'instant',
  categories       jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "notification_prefs_owner_select"
  on public.notification_preferences for select
  using (auth.uid() = user_id);

create policy "notification_prefs_owner_upsert"
  on public.notification_preferences for insert
  with check (auth.uid() = user_id);

create policy "notification_prefs_owner_update"
  on public.notification_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
`;

function SchemaSetupCard() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
            // database setup
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">Persist notifications in Supabase</h2>
          <p className="mt-1 max-w-2xl text-xs text-white/55">
            Run this SQL once. Until the tables exist, the feed runs locally
            via simulator and survives across reloads in <code className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[11px]">localStorage</code>. Schema is forward-compatible with the dispatch planner.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(NOTIFICATIONS_SQL);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            } catch {
              /* ignore */
            }
          }}
          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/70 transition hover:border-basil-400/40 hover:text-white"
        >
          {copied ? "Copied" : "Copy SQL"}
        </button>
      </header>
      <pre className="max-h-[360px] overflow-auto bg-black/50 p-4 font-mono text-[11px] leading-relaxed text-white/75">
        {NOTIFICATIONS_SQL}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Misc
// ---------------------------------------------------------------------------

function LiveIndicator({
  paused,
  severity,
}: {
  paused: boolean;
  severity: NotificationSeverity;
}) {
  const sev = severityClass(severity);
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] ${
        paused
          ? "border-white/10 bg-white/[0.03] text-white/45"
          : `${sev.ring} ${sev.text}`
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          paused ? "bg-white/30" : `${sev.dot} animate-pulse`
        }`}
      />
      {paused ? "feed paused" : "live feed"}
    </span>
  );
}

function FullPageMessage({ label }: { label: string }) {
  return (
    <div className="relative grid min-h-screen place-items-center bg-black text-white">
      <BackgroundFX />
      <div className="relative z-10 flex items-center gap-3 text-sm text-white/60">
        <span className="grid h-9 w-9 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10">
          <span className="block h-2 w-2 animate-pulse rounded-full bg-basil-300 shadow-[0_0_12px_rgba(111,232,154,1)]" />
        </span>
        {label}
      </div>
    </div>
  );
}

function BackgroundFX() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -top-40 left-1/4 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-basil-500/15 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-600/10 blur-[100px]" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/40 to-transparent" />
    </div>
  );
}
