"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  ActivityIcon,
  CardIcon,
  GaugeIcon,
  GearIcon,
  GlobeIcon,
  IconProps,
  LayersIcon,
  LockIcon,
  OverviewIcon,
  ProjectsIcon,
  RocketIcon,
  ServerIcon,
  ShieldIcon,
  TerminalIcon,
} from "@/src/components/ui/icons";
import { useLanguage, type TranslationKey } from "@/src/lib/i18n";

type AdminKey =
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

type NavItem = {
  key: AdminKey;
  i18n: TranslationKey;
  href: string;
  Icon: ComponentType<IconProps>;
};

type NavSection = {
  id: "platform" | "operations" | "security" | "system";
  i18n: TranslationKey;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    id: "platform",
    i18n: "admin.platform",
    items: [
      { key: "overview", i18n: "admin.overview", href: "/admin", Icon: OverviewIcon },
      { key: "users", i18n: "admin.users", href: "/admin/users", Icon: ShieldIcon },
      { key: "projects", i18n: "admin.projects", href: "/admin/projects", Icon: ProjectsIcon },
      { key: "analytics", i18n: "admin.analytics", href: "/admin/analytics", Icon: ActivityIcon },
    ],
  },
  {
    id: "operations",
    i18n: "admin.operations",
    items: [
      { key: "deployments", i18n: "admin.deployments", href: "/admin/deployments", Icon: RocketIcon },
      { key: "runtime", i18n: "admin.runtime", href: "/admin/runtime", Icon: LayersIcon },
      { key: "domains", i18n: "admin.domains", href: "/admin/domains", Icon: GlobeIcon },
      { key: "infrastructure", i18n: "admin.infrastructure", href: "/admin/infrastructure", Icon: ServerIcon },
      { key: "usage", i18n: "admin.usage", href: "/admin/usage", Icon: GaugeIcon },
      { key: "billing", i18n: "admin.billing", href: "/admin/billing", Icon: CardIcon },
    ],
  },
  {
    id: "security",
    i18n: "admin.security",
    items: [
      { key: "security", i18n: "admin.security", href: "/admin/security", Icon: LockIcon },
      { key: "audit", i18n: "admin.audit", href: "/admin/audit", Icon: TerminalIcon },
    ],
  },
  {
    id: "system",
    i18n: "admin.system",
    items: [
      { key: "settings", i18n: "admin.settings", href: "/admin/settings", Icon: GearIcon },
    ],
  },
];

export type AdminSidebarProps = {
  activeKey: AdminKey;
  operatorEmail?: string | null;
  operatorRole?: string | null;
};

export function AdminSidebar({
  activeKey,
  operatorEmail,
  operatorRole,
}: AdminSidebarProps) {
  const { t } = useLanguage();

  return (
    <aside className="flex shrink-0 flex-col border-b border-white/10 bg-black/45 backdrop-blur-xl md:w-64 md:border-b-0 md:border-r md:border-white/10">
      <div className="flex items-center justify-between gap-3 p-5 md:block">
        <Link
          href="/admin"
          className="flex items-center gap-2"
          aria-label={t("common.adminConsole")}
        >
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-red-400/30 bg-red-500/10 text-red-200">
            <ShieldIcon className="h-4 w-4" title={t("common.adminConsole")} />
          </div>
          <div className="leading-tight">
            <div className="text-xs font-semibold tracking-[0.28em] text-white">
              GTLNAV
            </div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-red-200/80">
              Operator console
            </div>
          </div>
        </Link>
      </div>

      <nav className="flex flex-col gap-3 overflow-x-auto px-2 pb-3 md:px-2 md:pb-6">
        {SECTIONS.map((section, sectionIdx) => (
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
                      ? "bg-red-500/15 text-red-100"
                      : "text-white/60 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors ${
                      active ? "text-red-200" : "text-white/45 group-hover:text-white/80"
                    }`}
                  >
                    <item.Icon className="h-4 w-4" title={label} />
                  </span>
                  <span>{label}</span>
                </Link>
              );
            })}
            {sectionIdx < SECTIONS.length - 1 ? (
              <span aria-hidden className="hidden h-px bg-white/[0.05] md:block" />
            ) : null}
          </div>
        ))}
      </nav>

      <div className="mt-auto hidden border-t border-white/10 p-4 md:block">
        {operatorEmail ? (
          <p className="truncate text-xs text-white/50">{operatorEmail}</p>
        ) : null}
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-red-200">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,1)]" />
          {operatorRole ?? "operator"}
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-basil-300/80 transition-colors hover:text-basil-200"
        >
          ← {t("common.userConsole")}
        </Link>
      </div>
    </aside>
  );
}
