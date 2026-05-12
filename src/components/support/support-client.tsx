"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";
import { ConfirmModal } from "@/src/components/ui/confirm-modal";
import {
  LifebuoyIcon,
  MailIcon,
  ShieldIcon,
  ZapIcon,
} from "@/src/components/ui/icons";
import { relativeTime } from "@/src/lib/dashboard-format";

const STORAGE_KEY = "gtlnav.support.tickets.v1";
const MAX_KEEP = 80;

type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
type TicketPriority = "low" | "normal" | "high" | "urgent";
type TicketCategory =
  | "billing"
  | "deployments"
  | "domains"
  | "runtime"
  | "security"
  | "account"
  | "feedback"
  | "other";

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  body: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
};

type Stored = {
  userId: string;
  tickets: Ticket[];
};

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "billing", label: "Billing" },
  { value: "deployments", label: "Deployments" },
  { value: "domains", label: "Domains" },
  { value: "runtime", label: "Runtime" },
  { value: "security", label: "Security" },
  { value: "account", label: "Account" },
  { value: "feedback", label: "Feedback" },
  { value: "other", label: "Other" },
];

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const STATUS_FILTERS: { value: TicketStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_user", label: "Waiting on you" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

function readStore(userId: string): Ticket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.userId !== userId) return [];
    return Array.isArray(parsed.tickets) ? parsed.tickets : [];
  } catch {
    return [];
  }
}

function writeStore(userId: string, tickets: Ticket[]) {
  if (typeof window === "undefined") return;
  try {
    const payload: Stored = { userId, tickets: tickets.slice(0, MAX_KEEP) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function generateId() {
  return `tic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function statusStyle(status: TicketStatus) {
  switch (status) {
    case "open":
      return { dot: "bg-amber-300", ring: "border-amber-400/40 bg-amber-500/10", text: "text-amber-200", label: "Open" };
    case "in_progress":
      return { dot: "bg-cyan-300", ring: "border-cyan-400/40 bg-cyan-500/10", text: "text-cyan-200", label: "In progress" };
    case "waiting_user":
      return { dot: "bg-violet-300", ring: "border-violet-400/40 bg-violet-500/10", text: "text-violet-200", label: "Waiting on you" };
    case "resolved":
      return { dot: "bg-basil-300", ring: "border-basil-400/40 bg-basil-500/10", text: "text-basil-200", label: "Resolved" };
    case "closed":
      return { dot: "bg-white/40", ring: "border-white/15 bg-white/[0.04]", text: "text-white/60", label: "Closed" };
  }
}

function priorityStyle(priority: TicketPriority) {
  switch (priority) {
    case "urgent":
      return "border-red-400/40 bg-red-500/10 text-red-200";
    case "high":
      return "border-amber-400/40 bg-amber-500/10 text-amber-200";
    case "normal":
      return "border-white/15 bg-white/[0.05] text-white/75";
    case "low":
      return "border-white/10 bg-white/[0.02] text-white/55";
  }
}

export function SupportClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<TicketStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState<Ticket | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      if (!s) {
        router.replace("/login");
        return;
      }
      setSession(s);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      if (!next) {
        router.replace("/login");
        return;
      }
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const cached = readStore(session.user.id);
    setTickets(cached);
    setHydrated(true);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !hydrated) return;
    writeStore(session.user.id, tickets);
  }, [tickets, session?.user?.id, hydrated]);

  const counts = useMemo(() => {
    const c = { all: tickets.length, open: 0, in_progress: 0, waiting_user: 0, resolved: 0, closed: 0 };
    for (const t of tickets) {
      c[t.status] += 1;
    }
    return c;
  }, [tickets]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return tickets
      .filter((t) => (filter === "all" ? true : t.status === filter))
      .filter((t) => {
        if (!s) return true;
        return (
          t.subject.toLowerCase().includes(s) ||
          t.body.toLowerCase().includes(s) ||
          t.category.toLowerCase().includes(s) ||
          t.id.toLowerCase().includes(s)
        );
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [tickets, filter, search]);

  const createTicket = useCallback(
    (input: { subject: string; body: string; category: TicketCategory; priority: TicketPriority }) => {
      if (!session?.user?.id) return;
      const now = new Date().toISOString();
      const ticket: Ticket = {
        id: generateId(),
        user_id: session.user.id,
        subject: input.subject.trim(),
        body: input.body.trim(),
        category: input.category,
        priority: input.priority,
        status: "open",
        created_at: now,
        updated_at: now,
      };
      setTickets((prev) => [ticket, ...prev]);
    },
    [session?.user?.id],
  );

  const closeTicket = useCallback((id: string) => {
    setTickets((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: "closed" as TicketStatus, updated_at: new Date().toISOString() }
          : t,
      ),
    );
    setConfirmClose(null);
  }, []);

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-basil-400/30 border-t-basil-400" />
          <p className="text-sm text-white/50">Loading…</p>
        </div>
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 right-0 h-[28rem] w-[28rem] rounded-full bg-basil-500/10 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[22rem] w-[22rem] rounded-full bg-basil-600/10 blur-[90px]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="support" userEmail={session.user.email ?? null} />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 space-y-6 p-4 sm:p-8">
            <PageHeader
              eyebrow="// support"
              title="Support center"
              subtitle="Open tickets, track responses, and reach the GTLNAV team."
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-4 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
                  >
                    ＋ New ticket
                  </button>
                  <a
                    href="mailto:support@gtlnav.com"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                  >
                    <MailIcon className="h-4 w-4" /> Email support
                  </a>
                </>
              }
            />

            <section className="grid gap-3 md:grid-cols-3">
              <ContactCard
                eyebrow="Standard"
                title="Email"
                body="Reach our team for non-urgent issues. Typical response under 24h."
                cta="support@gtlnav.com"
                href="mailto:support@gtlnav.com"
                Icon={MailIcon}
              />
              <ContactCard
                eyebrow="Urgent"
                title="Priority response"
                body="Production incidents impacting deployments, domains, or runtime."
                cta="Open urgent ticket"
                onClick={() => setCreateOpen(true)}
                Icon={ZapIcon}
              />
              <ContactCard
                eyebrow="Trust"
                title="Security disclosure"
                body="Vulnerability reports route directly to the GTLNAV security desk."
                cta="security@gtlnav.com"
                href="mailto:security@gtlnav.com"
                Icon={ShieldIcon}
              />
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  {STATUS_FILTERS.map((f) => {
                    const count =
                      f.value === "all"
                        ? counts.all
                        : (counts[f.value as TicketStatus] ?? 0);
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setFilter(f.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                          filter === f.value
                            ? "border-basil-400/45 bg-basil-500/15 text-basil-100"
                            : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        {f.label}
                        <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-white/70">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search subject, body, category…"
                  className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-basil-400/40 focus:outline-none md:w-72"
                />
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                {filtered.length === 0 ? (
                  <div className="grid place-items-center px-6 py-14 text-center">
                    <LifebuoyIcon className="h-8 w-8 text-basil-300/70" />
                    <p className="mt-3 text-sm font-medium text-white">
                      {tickets.length === 0
                        ? "No tickets yet"
                        : "No tickets match the current filter"}
                    </p>
                    <p className="mt-1 max-w-md text-xs text-white/50">
                      {tickets.length === 0
                        ? "When you open a ticket, it appears here with status, priority, and category. Click New ticket to start one."
                        : "Try clearing the search or selecting another status filter."}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {filtered.map((t) => {
                      const s = statusStyle(t.status);
                      const p = priorityStyle(t.priority);
                      return (
                        <li
                          key={t.id}
                          className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${s.ring}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                                <span className={s.text}>{s.label}</span>
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${p}`}
                              >
                                {t.priority}
                              </span>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/60">
                                {t.category}
                              </span>
                              <span className="font-mono text-[10px] text-white/30">
                                {t.id}
                              </span>
                            </div>
                            <p className="mt-1.5 truncate text-sm font-medium text-white">
                              {t.subject}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs text-white/55">
                              {t.body}
                            </p>
                            <p className="mt-1 text-[11px] text-white/40">
                              Created {relativeTime(t.created_at)} · Updated{" "}
                              {relativeTime(t.updated_at)}
                            </p>
                          </div>
                          {t.status !== "closed" ? (
                            <button
                              type="button"
                              onClick={() => setConfirmClose(t)}
                              className="shrink-0 self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/25 hover:text-white sm:self-center"
                            >
                              Close
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-white/35">
                Tickets are stored locally for now. The Phase 6 support
                pipeline will sync them to the GTLNAV ops desk.
              </p>
            </section>

            <p className="text-center text-[10px] uppercase tracking-[0.2em] text-white/30">
              GTLNAV support center · response SLA depends on plan tier ·{" "}
              <Link href="/dashboard/billing" className="text-basil-300 hover:text-basil-200">
                see billing
              </Link>
            </p>
          </main>
        </div>
      </div>

      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => {
          createTicket(input);
          setCreateOpen(false);
        }}
      />

      <ConfirmModal
        open={Boolean(confirmClose)}
        title={confirmClose ? `Close ticket "${confirmClose.subject}"?` : "Close ticket"}
        description="Closed tickets become read-only. You can always open a new one."
        confirmLabel="Close ticket"
        cancelLabel="Keep open"
        onClose={() => setConfirmClose(null)}
        onConfirm={() => confirmClose && closeTicket(confirmClose.id)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ContactCard({
  eyebrow,
  title,
  body,
  cta,
  href,
  onClick,
  Icon,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href?: string;
  onClick?: () => void;
  Icon: typeof MailIcon;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10 text-basil-200">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
            {eyebrow}
          </p>
          <p className="text-sm font-semibold text-white">{title}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-white/55">{body}</p>
      <p className="mt-3 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-basil-200 transition-colors group-hover:text-basil-100">
        {cta} <span aria-hidden>→</span>
      </p>
    </>
  );

  const cls =
    "group relative block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:-translate-y-0.5 hover:border-basil-400/30 hover:bg-basil-500/5";

  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${cls} text-left`}>
      {inner}
    </button>
  );
}

function CreateTicketModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    subject: string;
    body: string;
    category: TicketCategory;
    priority: TicketPriority;
  }) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSubject("");
      setBody("");
      setCategory("other");
      setPriority("normal");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 4) {
      setError("Subject must be at least 4 characters.");
      return;
    }
    if (body.trim().length < 10) {
      setError("Please describe the issue (at least 10 characters).");
      return;
    }
    onSubmit({ subject, body, category, priority });
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-6 backdrop-blur-2xl"
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
          // new-ticket
        </p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
          Open a support ticket
        </h2>
        <p className="mt-1 text-xs text-white/55">
          Tell us what's happening. The more detail, the faster we can help.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">
              Subject
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary of the issue"
              maxLength={140}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-basil-400/40"
              autoFocus
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                Category
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-basil-400/40"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-black">
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                Priority
              </span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-basil-400/40"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value} className="bg-black">
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">
              Description
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What were you trying to do? What happened? Include any project IDs, deployment IDs, or domains involved."
              rows={6}
              maxLength={4000}
              className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-basil-400/40"
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-red-200">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
          >
            Open ticket
          </button>
        </div>
      </form>
    </div>
  );
}
