/**
 * GTLNAV workspace role matrix.
 *
 * Roles are simulated client-side until row-level RLS policies are layered
 * on top of `workspace_members`. The helpers in this file are the single
 * source of truth for "what can role X do" so UI gating stays consistent.
 */

export type WorkspaceRole = "owner" | "admin" | "developer" | "viewer";

export type WorkspaceType = "personal" | "organization";

export const WORKSPACE_ROLES: WorkspaceRole[] = [
  "owner",
  "admin",
  "developer",
  "viewer",
];

/** Roles that can be assigned via invitations or via "change role" actions.
 * Owner is excluded because it's only conferred via creation or transfer. */
export const ASSIGNABLE_ROLES: Exclude<WorkspaceRole, "owner">[] = [
  "admin",
  "developer",
  "viewer",
];

export type Permission =
  | "manage_workspace"
  | "delete_workspace"
  | "transfer_ownership"
  | "invite_members"
  | "remove_members"
  | "change_member_roles"
  | "view_audit"
  | "deploy_projects"
  | "edit_projects"
  | "view_projects";

const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  owner: [
    "manage_workspace",
    "delete_workspace",
    "transfer_ownership",
    "invite_members",
    "remove_members",
    "change_member_roles",
    "view_audit",
    "deploy_projects",
    "edit_projects",
    "view_projects",
  ],
  admin: [
    "manage_workspace",
    "invite_members",
    "remove_members",
    "change_member_roles",
    "view_audit",
    "deploy_projects",
    "edit_projects",
    "view_projects",
  ],
  developer: ["deploy_projects", "edit_projects", "view_projects"],
  viewer: ["view_projects"],
};

export function hasPermission(
  role: WorkspaceRole | undefined | null,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Whether `actor` is allowed to act on `target`. Used to prevent admins
 * from demoting/removing the owner, etc. */
export function canActOnRole(
  actor: WorkspaceRole | undefined | null,
  target: WorkspaceRole,
): boolean {
  if (!actor) return false;
  if (actor === "owner") return target !== "owner"; // owner can't manage themselves
  if (actor === "admin") return target !== "owner" && target !== "admin";
  return false;
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  developer: 2,
  viewer: 1,
};

export function compareRole(a: WorkspaceRole, b: WorkspaceRole): number {
  return ROLE_RANK[b] - ROLE_RANK[a];
}

export function roleLabel(role: WorkspaceRole | string | null | undefined): string {
  if (!role) return "Unknown";
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "developer":
      return "Developer";
    case "viewer":
      return "Viewer";
    default:
      return String(role);
  }
}

export function roleStyle(role: WorkspaceRole | string | null | undefined): {
  pill: string;
  dot: string;
  text: string;
} {
  switch (role) {
    case "owner":
      return {
        pill: "border-amber-400/40 bg-amber-500/10 text-amber-200",
        dot: "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.95)]",
        text: "text-amber-200",
      };
    case "admin":
      return {
        pill: "border-basil-400/40 bg-basil-500/10 text-basil-200",
        dot: "bg-basil-300 shadow-[0_0_8px_rgba(125,231,164,0.95)]",
        text: "text-basil-200",
      };
    case "developer":
      return {
        pill: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
        dot: "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.95)]",
        text: "text-cyan-200",
      };
    case "viewer":
      return {
        pill: "border-white/15 bg-white/[0.04] text-white/75",
        dot: "bg-white/55",
        text: "text-white/75",
      };
    default:
      return {
        pill: "border-white/10 bg-white/[0.03] text-white/65",
        dot: "bg-white/40",
        text: "text-white/70",
      };
  }
}

/** Normalize a string into a slug suitable for a workspace URL fragment. */
export function workspaceSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `workspace-${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate a short token-like value used for invitation links. */
export function generateInviteToken(): string {
  // 24 chars, base36-ish; not cryptographically strong but sufficient for
  // simulated invitations until a server-side mailer is wired up.
  const part = () =>
    Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `${part()}${part()}${part()}`;
}

/** Build an "avatar" string (initials) from a person's display name/email. */
export function initialsFromIdentity(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  const fromName = (fullName ?? "").trim();
  if (fromName) {
    const parts = fromName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const fromEmail = (email ?? "").trim();
  if (fromEmail) {
    const local = fromEmail.split("@")[0];
    const cleaned = local.replace(/[^a-zA-Z0-9]/g, "");
    return cleaned.slice(0, 2).toUpperCase() || "??";
  }
  return "??";
}

/** Map a string identity into a stable basil/black-friendly accent color. */
export function avatarTone(seed: string): {
  background: string;
  ring: string;
  text: string;
} {
  const palette = [
    {
      background: "bg-basil-500/15",
      ring: "ring-basil-400/40",
      text: "text-basil-200",
    },
    {
      background: "bg-cyan-500/15",
      ring: "ring-cyan-400/40",
      text: "text-cyan-200",
    },
    {
      background: "bg-violet-500/15",
      ring: "ring-violet-400/40",
      text: "text-violet-200",
    },
    {
      background: "bg-amber-500/15",
      ring: "ring-amber-400/40",
      text: "text-amber-200",
    },
    {
      background: "bg-rose-500/15",
      ring: "ring-rose-400/40",
      text: "text-rose-200",
    },
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}
