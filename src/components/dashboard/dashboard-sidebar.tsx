"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { supabase } from "@/src/lib/supabase";
import {
  ActivityIcon,
  BellIcon,
  CardIcon,
  GaugeIcon,
  GearIcon,
  GlobeIcon,
  IconProps,
  LayersIcon,
  LifebuoyIcon,
  LockIcon,
  OverviewIcon,
  PlugIcon,
  ProjectsIcon,
  RocketIcon,
  ServerIcon,
  ShieldIcon,
  UsersIcon,
  WebhookIcon,
  ZapIcon,
} from "@/src/components/ui/icons";
import { NotificationCenter } from "@/src/components/notifications/notification-center";
import { useLanguage, type TranslationKey } from "@/src/lib/i18n";

type ActiveKey =
  | "overview"
  | "projects"
  | "deployments"
  | "runtime"
  | "functions"
  | "domains"
  | "infrastructure"
  | "analytics"
  | "usage"
  | "integrations"
  | "webhooks"
  | "team"
  | "billing"
  | "notifications"
  | "security"
  | "support"
  | "profile"
  | "settings";

type NavItem = {
  key: ActiveKey;
  /** i18n key (`nav.*`). The translator falls back to English. */
  i18n: TranslationKey;
  href: string;
  Icon: ComponentType<IconProps>;
};

type NavSection = {
  id: "core" | "infrastructure" | "developer" | "organization" | "account";
  i18n: TranslationKey;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    id: "core",
    i18n: "section.core",
    items: [
      { key: "overview", i18n: "nav.overview", href: "/dashboard", Icon: OverviewIcon },
      { key: "projects", i18n: "nav.projects", href: "/dashboard/projects", Icon: ProjectsIcon },
      { key: "deployments", i18n: "nav.deployments", href: "/dashboard/deployments", Icon: RocketIcon },
    ],
  },
  {
    id: "infrastructure",
    i18n: "section.infrastructure",
    items: [
      { key: "runtime", i18n: "nav.runtime", href: "/dashboard/runtime", Icon: LayersIcon },
      { key: "functions", i18n: "nav.functions", href: "/dashboard/functions", Icon: ZapIcon },
      { key: "domains", i18n: "nav.domains", href: "/dashboard/domains", Icon: GlobeIcon },
      { key: "infrastructure", i18n: "nav.infrastructure", href: "/dashboard/infrastructure", Icon: ServerIcon },
      { key: "analytics", i18n: "nav.analytics", href: "/dashboard/analytics", Icon: ActivityIcon },
    ],
  },
  {
    id: "developer",
    i18n: "section.developer",
    items: [
      { key: "integrations", i18n: "nav.integrations", href: "/dashboard/integrations", Icon: PlugIcon },
      { key: "webhooks", i18n: "nav.webhooks", href: "/dashboard/webhooks", Icon: WebhookIcon },
      { key: "security", i18n: "nav.security", href: "/dashboard/security", Icon: LockIcon },
    ],
  },
  {
    id: "organization",
    i18n: "section.organization",
    items: [
      { key: "team", i18n: "nav.team", href: "/dashboard/team", Icon: UsersIcon },
      { key: "usage", i18n: "nav.usage", href: "/dashboard/usage", Icon: GaugeIcon },
      { key: "billing", i18n: "nav.billing", href: "/dashboard/billing", Icon: CardIcon },
      { key: "notifications", i18n: "nav.notifications", href: "/dashboard/notifications", Icon: BellIcon },
    ],
  },
  {
    id: "account",
    i18n: "section.account",
    items: [
      { key: "profile", i18n: "nav.profile", href: "/dashboard/profile", Icon: UsersIcon },
      { key: "settings", i18n: "nav.settings", href: "/dashboard/settings", Icon: GearIcon },
      { key: "support", i18n: "nav.support", href: "/dashboard/support", Icon: LifebuoyIcon },
    ],
  },
];

export type DashboardSidebarProps = {
  activeKey: ActiveKey;
  userEmail?: string | null;
  billingPlan?: string;
  billingStatus?: string;
};

export function DashboardSidebar({
  activeKey,
  userEmail,
  billingPlan = "Free Beta",
  billingStatus = "active",
}: DashboardSidebarProps) {
  const isAdmin = useOperatorRole();
  const { t } = useLanguage();

  return (
    <aside className="flex shrink-0 flex-col border-b border-white/10 bg-black/40 backdrop-blur-xl md:w-60 md:border-b-0 md:border-r md:border-white/10">
      <div className="flex items-center justify-between gap-3 p-5">
        <Link
          href="/dashboard"
          className="flex items-center gap-2"
          aria-label={t("common.dashboard")}
        >
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-basil-400/30 bg-basil-500/10">
            <span className="text-[10px] font-bold tracking-widest text-basil-300">
              G
            </span>
          </div>
          <div className="leading-tight">
            <div className="text-xs font-semibold tracking-[0.28em] text-white">
              GTLNAV
            </div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-basil-300/70">
              Console
            </div>
          </div>
        </Link>
        <NotificationCenter operatorScope={isAdmin} align="right" />
      </div>

      <nav className="flex flex-col gap-3 overflow-x-auto px-2 pb-3 md:px-2 md:pb-6">
        {SECTIONS.map((section, idx) => (
          <div key={section.id} className="flex shrink-0 flex-row gap-1 md:flex-col">
            <p className="hidden px-3 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/35 md:block">
              {t(section.i18n)}
            </p>
            {section.items.map((item) => {
              const active = item.key === activeKey;
              const label = t(item.i18n);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`group inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors md:px-3.5 ${
                    active
                      ? "bg-basil-500/15 text-basil-100"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors ${
                      active
                        ? "text-basil-200"
                        : "text-white/45 group-hover:text-white/80"
                    }`}
                  >
                    <item.Icon className="h-4 w-4" title={label} />
                  </span>
                  <span>{label}</span>
                </Link>
              );
            })}
            {idx < SECTIONS.length - 1 ? (
              <span aria-hidden className="hidden h-px bg-white/[0.05] md:block" />
            ) : null}
          </div>
        ))}
        {isAdmin ? <AdminConsoleLink label={t("common.adminConsole")} /> : null}
      </nav>

      <div className="mt-auto hidden border-t border-white/10 p-4 md:block">
        {userEmail ? (
          <p className="truncate text-xs text-white/45">{userEmail}</p>
        ) : null}
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-basil-400/30 bg-basil-500/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-basil-200">
          <span className="h-1.5 w-1.5 rounded-full bg-basil-300 shadow-[0_0_8px_rgba(111,232,154,1)]" />
          {billingPlan} · {billingStatus}
        </p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-basil-300/60">
          A GODTECHLABS Infrastructure Platform
        </p>
      </div>
    </aside>
  );
}

function AdminConsoleLink({ label }: { label: string }) {
  return (
    <div className="md:mt-2">
      <p className="hidden px-3 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-[0.28em] text-white/35 md:block">
        Operator
      </p>
      <Link
        href="/admin"
        className="group relative inline-flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-red-400/30 bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent px-3 py-2.5 text-sm text-red-100 shadow-[0_0_24px_-12px_rgba(248,113,113,0.7)] transition-all hover:border-red-400/50 hover:from-red-500/20 hover:to-red-500/5 hover:text-red-50 hover:shadow-[0_0_28px_-8px_rgba(248,113,113,0.9)] md:px-3.5"
        aria-label={label}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-300/60 to-transparent opacity-70"
        />
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-red-500/15 text-red-200 transition-colors group-hover:bg-red-500/25">
          <ShieldIcon className="h-4 w-4" title={label} />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-medium">{label}</span>
          <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-red-200/75">
            Operator
          </span>
        </span>
      </Link>
    </div>
  );
}

function useOperatorRole(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(uid: string) {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setIsAdmin(false);
        return;
      }
      const role = ((data as { role?: string | null }).role ?? "")
        .toString()
        .toLowerCase();
      setIsAdmin(role === "admin" || role === "super_admin");
    }

    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      if (!s) {
        setIsAdmin(false);
        return;
      }
      void load(s.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!newSession) {
        setIsAdmin(false);
        return;
      }
      void load(newSession.user.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return isAdmin;
}
