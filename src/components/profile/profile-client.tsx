"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PageHeader } from "@/src/components/ui/page-header";
import {
  BellIcon,
  GearIcon,
  LifebuoyIcon,
  UsersIcon,
} from "@/src/components/ui/icons";
import {
  SUPPORTED_LANGUAGES,
  isLanguage,
  readStoredLanguage,
  writeStoredLanguage,
  type Language,
} from "@/src/lib/i18n";

const PROFILE_STORAGE_KEY = "gtlnav.profile.preferences.v1";

type LocalPrefs = {
  userId: string;
  phone: string;
  timezone: string;
  default_workspace: string;
  language: Language;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Mexico_City",
  "America/Port-au-Prince",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Lagos",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

function readLocalPrefs(userId: string): LocalPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalPrefs;
    if (parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalPrefs(p: LocalPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function defaultTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function avatarInitials(name: string | null | undefined, email: string | null | undefined) {
  const source = (name && name.trim()) || (email && email.trim()) || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function ProfileClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState<string>(defaultTimezone());
  const [defaultWorkspace, setDefaultWorkspace] = useState("personal");
  const [language, setLanguage] = useState<Language>("en");

  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  /* ---------------------- session bootstrap ---------------------- */
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

  /* ---------------------- profile + prefs ---------------------- */
  const refresh = useCallback(async (uid: string) => {
    setLoadingProfile(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, company, role")
      .eq("id", uid)
      .maybeSingle();
    if (error) {
      setProfileError(error.message);
    } else {
      setProfileError(null);
    }
    const row = (data as ProfileRow | null) ?? null;
    setProfile(row);
    setFullName(row?.full_name ?? "");
    setCompany(row?.company ?? "");
    setLoadingProfile(false);
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    void refresh(session.user.id);
    const local = readLocalPrefs(session.user.id);
    if (local) {
      setPhone(local.phone ?? "");
      setTimezone(local.timezone ?? defaultTimezone());
      setDefaultWorkspace(local.default_workspace ?? "personal");
      setLanguage(isLanguage(local.language) ? local.language : readStoredLanguage());
    } else {
      setPhone("");
      setTimezone(defaultTimezone());
      setDefaultWorkspace("personal");
      setLanguage(readStoredLanguage());
    }
  }, [session?.user?.id, refresh]);

  /* ---------------------- save ---------------------- */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!session?.user?.id) return;
    setSaving(true);
    setSaveOk(false);
    setSaveErr(null);

    const uid = session.user.id;

    // Try to persist full_name + company to public.profiles. Schema-tolerant:
    // if the columns don't exist, fall back to full_name only, then skip.
    const tryUpdate = async (
      payload: Record<string, string>,
    ): Promise<{ ok: boolean; error?: string }> => {
      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", uid);
      if (!error) return { ok: true };
      return { ok: false, error: error.message };
    };

    const fullPayload: Record<string, string> = {
      full_name: fullName.trim(),
      company: company.trim(),
    };
    let result = await tryUpdate(fullPayload);
    if (!result.ok && /column.*company/i.test(result.error ?? "")) {
      result = await tryUpdate({ full_name: fullName.trim() });
    }
    if (!result.ok) {
      // Most likely cause: missing row. Try upsert with the user's id.
      const { error: upsertErr } = await supabase
        .from("profiles")
        .upsert({ id: uid, full_name: fullName.trim(), company: company.trim() });
      if (upsertErr && /column.*company/i.test(upsertErr.message)) {
        const { error: fallbackErr } = await supabase
          .from("profiles")
          .upsert({ id: uid, full_name: fullName.trim() });
        if (fallbackErr) {
          setSaveErr(fallbackErr.message);
        }
      } else if (upsertErr) {
        setSaveErr(upsertErr.message);
      }
    }

    // Always persist local prefs (phone, timezone, default workspace, language).
    writeLocalPrefs({
      userId: uid,
      phone: phone.trim(),
      timezone,
      default_workspace: defaultWorkspace,
      language,
    });
    writeStoredLanguage(language);

    if (!saveErr) setSaveOk(true);
    setSaving(false);
    void refresh(uid);
  }

  const initials = useMemo(
    () =>
      avatarInitials(
        profile?.full_name ?? fullName ?? null,
        session?.user?.email ?? profile?.email ?? null,
      ),
    [profile?.full_name, profile?.email, session?.user?.email, fullName],
  );

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-basil-400/30 border-t-basil-400" />
          <p className="text-sm text-white/50">Loading profile…</p>
        </div>
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 right-0 h-[26rem] w-[26rem] rounded-full bg-basil-500/10 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[20rem] w-[20rem] rounded-full bg-basil-600/10 blur-[90px]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="profile" userEmail={session.user.email ?? null} />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 space-y-6 p-4 sm:p-8">
            <PageHeader
              eyebrow="// account / profile"
              title="Your profile"
              subtitle="Identity, contact, locale, and default workspace settings."
              actions={
                <>
                  <Link
                    href="/dashboard/notifications"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                  >
                    <BellIcon className="h-4 w-4" /> Notification preferences
                  </Link>
                  <Link
                    href="/dashboard/settings"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                  >
                    <GearIcon className="h-4 w-4" /> Developer settings
                  </Link>
                  <Link
                    href="/dashboard/support"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-white/85 transition-colors hover:border-basil-400/40 hover:bg-basil-500/10"
                  >
                    <LifebuoyIcon className="h-4 w-4" /> Support
                  </Link>
                </>
              }
            />

            {profileError ? (
              <div role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p className="font-medium">Profile load warning</p>
                <p className="mt-1 text-amber-200/80">{profileError}</p>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[280px_1fr]">
              {/* Avatar + identity card */}
              <section className="relative h-fit rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
                <div className="grid h-24 w-24 place-items-center rounded-2xl border border-basil-400/30 bg-gradient-to-br from-basil-500/20 via-basil-500/5 to-transparent text-3xl font-bold tracking-tight text-basil-100">
                  {initials}
                </div>
                <p className="mt-4 text-sm font-semibold text-white">
                  {profile?.full_name || fullName || session.user.email}
                </p>
                <p className="mt-0.5 truncate text-xs text-white/55">
                  {session.user.email}
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/65">
                  <UsersIcon className="h-3 w-3" />
                  {(profile?.role ?? "client").toString()}
                </p>
                <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-white/35">
                  Avatar uploads come in Phase 6. For now we render initials.
                </p>
              </section>

              {/* Editable card */}
              <section className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                    Identity
                  </h2>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Full name">
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Jane Doe"
                        maxLength={120}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-basil-400/40"
                      />
                    </Field>
                    <Field label="Company / Organization">
                      <input
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Optional"
                        maxLength={120}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-basil-400/40"
                      />
                    </Field>
                    <Field label="Email" hint="Managed via account auth.">
                      <input
                        type="email"
                        value={session.user.email ?? ""}
                        readOnly
                        className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/55 outline-none"
                      />
                    </Field>
                    <Field label="Phone (optional)">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+1 555 123 4567"
                        maxLength={32}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-basil-400/40"
                      />
                    </Field>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                    Locale
                  </h2>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Preferred language" hint="Applies to navigation immediately.">
                      <select
                        value={language}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (isLanguage(next)) setLanguage(next);
                        }}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-basil-400/40"
                      >
                        {SUPPORTED_LANGUAGES.map((l) => (
                          <option key={l.code} value={l.code} className="bg-black">
                            {l.label} ({l.englishLabel})
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Timezone">
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-basil-400/40"
                      >
                        {TIMEZONES.includes(timezone) ? null : (
                          <option value={timezone} className="bg-black">
                            {timezone}
                          </option>
                        )}
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz} className="bg-black">
                            {tz}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/55">
                    Workspace
                  </h2>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Default workspace" hint="The workspace selected when you sign in.">
                      <input
                        type="text"
                        value={defaultWorkspace}
                        onChange={(e) => setDefaultWorkspace(e.target.value)}
                        placeholder="personal"
                        maxLength={64}
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-basil-400/40"
                      />
                    </Field>
                    <Field label="Notification preferences">
                      <Link
                        href="/dashboard/notifications"
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-basil-400/35 bg-basil-500/10 px-3 py-2 text-sm text-basil-100 transition-colors hover:border-basil-400/55 hover:bg-basil-500/20"
                      >
                        Open notification center →
                      </Link>
                    </Field>
                  </div>
                </div>

                {saveErr ? (
                  <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {saveErr}
                  </div>
                ) : null}
                {saveOk ? (
                  <div role="status" className="rounded-2xl border border-basil-400/30 bg-basil-500/10 px-4 py-3 text-sm text-basil-100">
                    Profile updated.
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.06] pt-4">
                  <Link
                    href="/dashboard"
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={saving || loadingProfile}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-5 py-2 text-sm font-semibold text-black shadow-[0_0_30px_-8px_rgba(111,232,154,0.7)] transition-all hover:shadow-[0_0_45px_-5px_rgba(111,232,154,1)] disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save profile"}
                  </button>
                </div>
              </section>
            </form>
          </main>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.18em] text-white/55">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-white/40">{hint}</p> : null}
    </label>
  );
}
