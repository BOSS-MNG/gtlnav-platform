"use client";

/**
 * GTLNAV localization foundation (Phase 5B).
 *
 * Lightweight in-app i18n. The platform is still primarily English; this
 * module provides:
 *   1. A typed list of supported languages (en / fr / ht).
 *   2. A label dictionary for the *navigation surface only* — sidebar,
 *      account section, admin sidebar.
 *   3. A `useLanguage()` hook that reads the current preference from
 *      localStorage and emits an event when the preference changes.
 *
 * NOTE: This is intentionally NOT a full translation system. Body copy
 * stays in English until each module is internationalized individually.
 * Falls back to English for any missing key.
 */

import { useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Supported languages                                                */
/* ------------------------------------------------------------------ */

export type Language = "en" | "fr" | "ht";

export type LanguageMeta = {
  code: Language;
  /** Native name (shown to the user). */
  label: string;
  /** English name (used in admin tools / debug). */
  englishLabel: string;
  /** Direction. All three are LTR for now. */
  dir: "ltr" | "rtl";
};

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { code: "en", label: "English", englishLabel: "English", dir: "ltr" },
  { code: "fr", label: "Français", englishLabel: "French", dir: "ltr" },
  { code: "ht", label: "Kreyòl Ayisyen", englishLabel: "Haitian Creole", dir: "ltr" },
];

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "fr" || value === "ht";
}

export function languageMeta(code: Language): LanguageMeta {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? SUPPORTED_LANGUAGES[0];
}

/* ------------------------------------------------------------------ */
/*  Translation keys                                                   */
/* ------------------------------------------------------------------ */

/**
 * Keys translated in this phase. Add more in a follow-up phase.
 * The prefix indicates the surface (`nav.*` for sidebar items, `acct.*`
 * for the Account section, `admin.*` for the operator console).
 */
export type TranslationKey =
  // user nav
  | "nav.overview"
  | "nav.projects"
  | "nav.deployments"
  | "nav.runtime"
  | "nav.functions"
  | "nav.domains"
  | "nav.infrastructure"
  | "nav.analytics"
  | "nav.integrations"
  | "nav.webhooks"
  | "nav.security"
  | "nav.team"
  | "nav.usage"
  | "nav.billing"
  | "nav.notifications"
  | "nav.profile"
  | "nav.settings"
  | "nav.support"
  // section labels
  | "section.core"
  | "section.infrastructure"
  | "section.developer"
  | "section.organization"
  | "section.account"
  | "section.operator"
  // top-level / cross-cutting
  | "common.adminConsole"
  | "common.userConsole"
  | "common.signOut"
  | "common.dashboard"
  | "common.profile"
  | "common.settings"
  | "common.notifications"
  | "common.support"
  | "common.viewAll"
  | "common.markAllRead"
  | "common.clear"
  // admin nav
  | "admin.overview"
  | "admin.users"
  | "admin.projects"
  | "admin.deployments"
  | "admin.runtime"
  | "admin.domains"
  | "admin.infrastructure"
  | "admin.analytics"
  | "admin.usage"
  | "admin.billing"
  | "admin.security"
  | "admin.audit"
  | "admin.settings"
  | "admin.platform"
  | "admin.operations"
  | "admin.system";

type Catalog = Partial<Record<TranslationKey, string>>;

const EN: Catalog = {
  "nav.overview": "Overview",
  "nav.projects": "Projects",
  "nav.deployments": "Deployments",
  "nav.runtime": "Runtime",
  "nav.functions": "Functions",
  "nav.domains": "Domains",
  "nav.infrastructure": "Infrastructure",
  "nav.analytics": "Analytics",
  "nav.integrations": "Integrations",
  "nav.webhooks": "Webhooks",
  "nav.security": "Security",
  "nav.team": "Team",
  "nav.usage": "Usage",
  "nav.billing": "Billing",
  "nav.notifications": "Notifications",
  "nav.profile": "Profile",
  "nav.settings": "Settings",
  "nav.support": "Support",

  "section.core": "Core",
  "section.infrastructure": "Infrastructure",
  "section.developer": "Developer",
  "section.organization": "Organization",
  "section.account": "Account",
  "section.operator": "Operator",

  "common.adminConsole": "Admin Console",
  "common.userConsole": "User Console",
  "common.signOut": "Sign out",
  "common.dashboard": "Dashboard",
  "common.profile": "Profile",
  "common.settings": "Settings",
  "common.notifications": "Notifications",
  "common.support": "Support",
  "common.viewAll": "View all notifications",
  "common.markAllRead": "Mark all read",
  "common.clear": "Clear",

  "admin.overview": "Overview",
  "admin.users": "Users",
  "admin.projects": "Projects",
  "admin.deployments": "Deployments",
  "admin.runtime": "Runtime",
  "admin.domains": "Domains",
  "admin.infrastructure": "Infrastructure",
  "admin.analytics": "Analytics",
  "admin.usage": "Usage",
  "admin.billing": "Billing",
  "admin.security": "Security",
  "admin.audit": "Audit",
  "admin.settings": "Settings",
  "admin.platform": "Platform",
  "admin.operations": "Operations",
  "admin.system": "System",
};

const FR: Catalog = {
  "nav.overview": "Vue d'ensemble",
  "nav.projects": "Projets",
  "nav.deployments": "Déploiements",
  "nav.runtime": "Exécution",
  "nav.functions": "Fonctions",
  "nav.domains": "Domaines",
  "nav.infrastructure": "Infrastructure",
  "nav.analytics": "Analytique",
  "nav.integrations": "Intégrations",
  "nav.webhooks": "Webhooks",
  "nav.security": "Sécurité",
  "nav.team": "Équipe",
  "nav.usage": "Utilisation",
  "nav.billing": "Facturation",
  "nav.notifications": "Notifications",
  "nav.profile": "Profil",
  "nav.settings": "Paramètres",
  "nav.support": "Assistance",

  "section.core": "Principal",
  "section.infrastructure": "Infrastructure",
  "section.developer": "Développeur",
  "section.organization": "Organisation",
  "section.account": "Compte",
  "section.operator": "Opérateur",

  "common.adminConsole": "Console Admin",
  "common.userConsole": "Console Utilisateur",
  "common.signOut": "Déconnexion",
  "common.dashboard": "Tableau de bord",
  "common.profile": "Profil",
  "common.settings": "Paramètres",
  "common.notifications": "Notifications",
  "common.support": "Assistance",
  "common.viewAll": "Voir toutes les notifications",
  "common.markAllRead": "Tout marquer lu",
  "common.clear": "Effacer",

  "admin.overview": "Vue d'ensemble",
  "admin.users": "Utilisateurs",
  "admin.projects": "Projets",
  "admin.deployments": "Déploiements",
  "admin.runtime": "Exécution",
  "admin.domains": "Domaines",
  "admin.infrastructure": "Infrastructure",
  "admin.analytics": "Analytique",
  "admin.usage": "Utilisation",
  "admin.billing": "Facturation",
  "admin.security": "Sécurité",
  "admin.audit": "Audit",
  "admin.settings": "Paramètres",
  "admin.platform": "Plateforme",
  "admin.operations": "Opérations",
  "admin.system": "Système",
};

const HT: Catalog = {
  "nav.overview": "Apèsi",
  "nav.projects": "Pwojè",
  "nav.deployments": "Deplwaman",
  "nav.runtime": "Egzekisyon",
  "nav.functions": "Fonksyon",
  "nav.domains": "Domèn",
  "nav.infrastructure": "Enfrastrikti",
  "nav.analytics": "Analiz",
  "nav.integrations": "Entegrasyon",
  "nav.webhooks": "Webhooks",
  "nav.security": "Sekirite",
  "nav.team": "Ekip",
  "nav.usage": "Itilizasyon",
  "nav.billing": "Fakti",
  "nav.notifications": "Notifikasyon",
  "nav.profile": "Pwofil",
  "nav.settings": "Paramèt",
  "nav.support": "Sipò",

  "section.core": "Prensipal",
  "section.infrastructure": "Enfrastrikti",
  "section.developer": "Devlopè",
  "section.organization": "Òganizasyon",
  "section.account": "Kont",
  "section.operator": "Operatè",

  "common.adminConsole": "Konsòl Admin",
  "common.userConsole": "Konsòl Itilizatè",
  "common.signOut": "Dekonekte",
  "common.dashboard": "Tablodbò",
  "common.profile": "Pwofil",
  "common.settings": "Paramèt",
  "common.notifications": "Notifikasyon",
  "common.support": "Sipò",
  "common.viewAll": "Wè tout notifikasyon yo",
  "common.markAllRead": "Make tout li",
  "common.clear": "Efase",

  "admin.overview": "Apèsi",
  "admin.users": "Itilizatè",
  "admin.projects": "Pwojè",
  "admin.deployments": "Deplwaman",
  "admin.runtime": "Egzekisyon",
  "admin.domains": "Domèn",
  "admin.infrastructure": "Enfrastrikti",
  "admin.analytics": "Analiz",
  "admin.usage": "Itilizasyon",
  "admin.billing": "Fakti",
  "admin.security": "Sekirite",
  "admin.audit": "Odit",
  "admin.settings": "Paramèt",
  "admin.platform": "Platfòm",
  "admin.operations": "Operasyon",
  "admin.system": "Sistèm",
};

const CATALOGS: Record<Language, Catalog> = { en: EN, fr: FR, ht: HT };

/* ------------------------------------------------------------------ */
/*  Translation function                                               */
/* ------------------------------------------------------------------ */

export function translate(language: Language, key: TranslationKey): string {
  const fromLang = CATALOGS[language]?.[key];
  if (fromLang) return fromLang;
  // Fallback: English, then the raw key as a last resort.
  return CATALOGS.en[key] ?? key;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "gtlnav.language.v1";
const EVENT_NAME = "gtlnav:language";

export function readStoredLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isLanguage(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANGUAGE;
}

export function writeStoredLanguage(language: Language): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
    window.dispatchEvent(
      new CustomEvent<Language>(EVENT_NAME, { detail: language }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Read the current language preference reactively. Updates on:
 *  - same-tab changes (via the custom `gtlnav:language` event)
 *  - cross-tab changes (via the standard `storage` event)
 */
export function useLanguage(): {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: TranslationKey) => string;
} {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    setLanguageState(readStoredLanguage());

    function onLocal(e: Event) {
      const ce = e as CustomEvent<Language>;
      if (ce.detail && isLanguage(ce.detail)) setLanguageState(ce.detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue && isLanguage(e.newValue)) setLanguageState(e.newValue);
    }

    window.addEventListener(EVENT_NAME, onLocal as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onLocal as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function setLanguage(next: Language) {
    setLanguageState(next);
    writeStoredLanguage(next);
  }

  function t(key: TranslationKey): string {
    return translate(language, key);
  }

  return { language, setLanguage, t };
}
