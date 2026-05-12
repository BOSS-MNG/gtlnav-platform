"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { ShieldIcon } from "@/src/components/ui/icons";
import { AdminSidebar } from "@/src/components/admin/admin-sidebar";

export type AdminRole = "admin" | "super_admin";
export type AnyRole = AdminRole | "client" | string;

export type AdminProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AnyRole | null;
  company: string | null;
  created_at: string | null;
};

export type AdminContext = {
  session: Session;
  profile: AdminProfile;
  isSuperAdmin: boolean;
  refreshProfile: () => Promise<void>;
};

type ActiveKey =
  | "overview"
  | "users"
  | "projects"
  | "deployments"
  | "domains"
  | "infrastructure"
  | "analytics"
  | "runtime"
  | "usage"
  | "billing"
  | "security"
  | "audit"
  | "settings";

type AdminShellProps = {
  activeKey: ActiveKey;
  eyebrow: string;
  title: string;
  description?: string;
  headerRight?: ReactNode;
  children: (ctx: AdminContext) => ReactNode;
};

type GateStatus = "loading" | "unauth" | "denied" | "ready" | "missing";

export function AdminShell({
  activeKey,
  eyebrow,
  title,
  description,
  headerRight,
  children,
}: AdminShellProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [status, setStatus] = useState<GateStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (uid: string) => {
    const { data, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, company, created_at")
      .eq("id", uid)
      .maybeSingle();

    if (profileErr) {
      setError(profileErr.message);
      setStatus("missing");
      return;
    }

    if (!data) {
      setProfile(null);
      setStatus("missing");
      return;
    }

    const p = data as AdminProfile;
    setProfile(p);
    const role = (p.role ?? "").toLowerCase();
    if (role === "admin" || role === "super_admin") {
      setStatus("ready");
    } else {
      setStatus("denied");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (cancelled) return;
      if (!s) {
        setSession(null);
        setStatus("unauth");
        router.replace("/login");
        return;
      }
      setSession(s);
      await loadProfile(s.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        setSession(null);
        setStatus("unauth");
        router.replace("/login");
        return;
      }
      setSession(newSession);
      void loadProfile(newSession.user.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  }, [session?.user?.id, loadProfile]);

  const ctx = useMemo<AdminContext | null>(() => {
    if (status !== "ready" || !session || !profile) return null;
    return {
      session,
      profile,
      isSuperAdmin: (profile.role ?? "").toLowerCase() === "super_admin",
      refreshProfile,
    };
  }, [status, session, profile, refreshProfile]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070707] text-white">
      {/* Background ambience */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(60% 50% at 75% 0%, rgba(248,113,113,0.12) 0%, transparent 60%), radial-gradient(50% 40% at 10% 100%, rgba(111,232,154,0.06) 0%, transparent 70%), radial-gradient(45% 35% at 50% 50%, rgba(255,255,255,0.025) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 50% at 50% 30%, black, transparent 75%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <AdminSidebar
          activeKey={activeKey}
          operatorEmail={profile?.email ?? session?.user?.email ?? null}
          operatorRole={profile?.role ?? null}
        />

        <main className="flex-1 p-5 md:p-8">
          {/* Topbar */}
          <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-200 shadow-[0_0_24px_-8px_rgba(248,113,113,0.7)]">
                <ShieldIcon className="h-5 w-5" title="Admin" />
              </div>
              <div className="leading-tight">
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-red-200/80">
                  {eyebrow}
                </p>
                <h1 className="text-lg font-semibold tracking-tight md:text-xl">
                  {title}
                </h1>
                {description ? (
                  <p className="mt-1 text-xs text-white/55">{description}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative hidden md:block">
                <input
                  type="text"
                  placeholder="Search users, projects, domains…"
                  disabled
                  className="w-72 rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/60 placeholder:text-white/30 focus:outline-none disabled:cursor-not-allowed"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.18em] text-white/30">
                  soon
                </span>
              </div>

              <span className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-red-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,1)]" />
                Operator · {profile?.role ?? "loading"}
              </span>

              {headerRight}
            </div>
          </header>

          {/* Body */}
          <section className="mt-6">
            {status === "loading" ? <ShellLoading /> : null}
            {status === "unauth" ? <ShellLoading /> : null}
            {status === "missing" ? (
              <AccessProblem
                tone="warning"
                eyebrow="// profile-missing"
                heading="No profile found"
                body={
                  error
                    ? `Couldn't load profile: ${error}`
                    : "Your profile record could not be loaded. Make sure a row exists in public.profiles for this user."
                }
              />
            ) : null}
            {status === "denied" ? (
              <AccessProblem
                tone="danger"
                eyebrow="// access-denied"
                heading="You don't have operator access"
                body="This area is restricted to GTLNAV admins and super admins. If you need access, contact a super admin."
              />
            ) : null}
            {status === "ready" && ctx ? children(ctx) : null}
          </section>
        </main>
      </div>
    </div>
  );
}

function ShellLoading() {
  return (
    <div className="grid place-items-center rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-center backdrop-blur-xl">
      <div className="grid h-10 w-10 place-items-center rounded-full border border-red-400/30 bg-red-500/10">
        <span className="h-2 w-2 animate-ping rounded-full bg-red-400" />
      </div>
      <p className="mt-4 text-xs uppercase tracking-[0.28em] text-white/55">
        Authenticating operator…
      </p>
    </div>
  );
}

function AccessProblem({
  tone,
  eyebrow,
  heading,
  body,
}: {
  tone: "danger" | "warning";
  eyebrow: string;
  heading: string;
  body: string;
}) {
  const ring =
    tone === "danger"
      ? "border-red-400/30 from-red-500/15"
      : "border-amber-400/30 from-amber-500/15";
  const text = tone === "danger" ? "text-red-200" : "text-amber-200";
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br via-white/[0.02] to-transparent p-10 backdrop-blur-xl ${ring}`}
    >
      <p
        className={`text-[10px] font-medium uppercase tracking-[0.28em] ${text}`}
      >
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
        {heading}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-white/65">{body}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)]"
        >
          ← Back to dashboard
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/30 hover:text-white"
        >
          Switch account
        </Link>
      </div>
    </div>
  );
}

export function AdminRlsWarning({
  visible,
  message,
}: {
  visible: boolean;
  message?: string;
}) {
  if (!visible) return null;
  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
      <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-amber-300/90">
        // rls-notice
      </p>
      <p className="mt-1 font-medium text-amber-100">
        Limited admin visibility detected
      </p>
      <p className="mt-1 text-amber-100/80">
        {message ??
          "Some queries may have been restricted by row-level security. To grant full operator visibility, add admin-aware RLS policies (or a service RPC) on the affected tables. Don't ship the service_role key to the browser."}
      </p>
    </div>
  );
}
