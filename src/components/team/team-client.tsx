"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/src/lib/supabase";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { ConfirmModal } from "@/src/components/ui/confirm-modal";
import {
  BuildingIcon,
  ChevronDownIcon,
  CrownIcon,
  MailIcon,
  UserPlusIcon,
  UsersIcon,
} from "@/src/components/ui/icons";
import {
  ASSIGNABLE_ROLES,
  avatarTone,
  canActOnRole,
  generateInviteToken,
  hasPermission,
  initialsFromIdentity,
  roleLabel,
  roleStyle,
  workspaceSlug,
  type Permission,
  type WorkspaceRole,
  type WorkspaceType,
} from "@/src/lib/workspace-permissions";
import {
  logLevel,
  logLevelClasses,
  logMessage,
  shortTime,
} from "@/src/lib/dashboard-format";

const STORAGE_ACTIVE_WS = "gtlnav_active_workspace_id";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

type WorkspaceRow = {
  id: string;
  name: string | null;
  slug: string | null;
  type: WorkspaceType | string | null;
  owner_id: string | null;
  created_at: string | null;
  updated_at?: string | null;
  description?: string | null;
  [key: string]: unknown;
};

type MemberRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  role: string | null;
  created_at: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

type InviteRow = {
  id: string;
  workspace_id: string;
  email: string | null;
  role: string | null;
  token: string | null;
  invited_by: string | null;
  status: string | null;
  created_at: string | null;
  expires_at?: string | null;
  [key: string]: unknown;
};

type ProjectWorkspaceRow = {
  id: string;
  project_id: string;
  workspace_id: string;
  created_at?: string | null;
  [key: string]: unknown;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company?: string | null;
  avatar_url?: string | null;
  [key: string]: unknown;
};

type LogRow = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  event_type: string | null;
  level: string | null;
  severity: string | null;
  message: string | null;
  source: string | null;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type ProjectRow = {
  id: string;
  name: string | null;
  user_id: string | null;
  [key: string]: unknown;
};

type TeamLoad = {
  workspaces: WorkspaceRow[];
  members: MemberRow[];
  invites: InviteRow[];
  links: ProjectWorkspaceRow[];
  projects: ProjectRow[];
  audit: LogRow[];
  errors: string[];
  missingTables: string[];
};

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes("schema cache")
  );
}

async function insertInfraLog(
  userId: string,
  eventType: string,
  message: string,
  severity: string,
  metadata?: Record<string, unknown>,
  projectId?: string | null,
) {
  const full = {
    user_id: userId,
    project_id: projectId ?? null,
    event_type: eventType,
    level: severity,
    severity,
    message,
    source: "team_workspaces",
    metadata: metadata ?? {},
  };
  const { error } = await supabase.from("infrastructure_logs").insert(full);
  if (!error) return;
  await supabase.from("infrastructure_logs").insert({
    user_id: userId,
    project_id: projectId ?? null,
    event_type: eventType,
    severity,
    message,
  });
}

async function loadTeamData(userId: string): Promise<TeamLoad> {
  const errors: string[] = [];
  const missingTables: string[] = [];

  const workspacesRes = await supabase
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: true });

  if (workspacesRes.error) {
    if (isMissingTableError(workspacesRes.error.message)) {
      missingTables.push("workspaces");
    } else {
      errors.push(`workspaces: ${workspacesRes.error.message}`);
    }
  }

  const workspaces = (workspacesRes.data ?? []) as WorkspaceRow[];

  const membersRes = await supabase
    .from("workspace_members")
    .select("*")
    .order("created_at", { ascending: true });

  if (membersRes.error) {
    if (isMissingTableError(membersRes.error.message)) {
      missingTables.push("workspace_members");
    } else {
      errors.push(`workspace_members: ${membersRes.error.message}`);
    }
  }

  const members = (membersRes.data ?? []) as MemberRow[];

  const invitesRes = await supabase
    .from("workspace_invitations")
    .select("*")
    .order("created_at", { ascending: false });

  if (invitesRes.error) {
    if (isMissingTableError(invitesRes.error.message)) {
      missingTables.push("workspace_invitations");
    } else {
      errors.push(`workspace_invitations: ${invitesRes.error.message}`);
    }
  }

  const invites = (invitesRes.data ?? []) as InviteRow[];

  const linksRes = await supabase.from("project_workspaces").select("*");

  if (linksRes.error) {
    if (isMissingTableError(linksRes.error.message)) {
      missingTables.push("project_workspaces");
    } else {
      errors.push(`project_workspaces: ${linksRes.error.message}`);
    }
  }

  const links = (linksRes.data ?? []) as ProjectWorkspaceRow[];

  const projectsRes = await supabase
    .from("projects")
    .select("id, name, user_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (projectsRes.error) {
    errors.push(`projects: ${projectsRes.error.message}`);
  }

  const projects = (projectsRes.data ?? []) as ProjectRow[];

  const auditRes = await supabase
    .from("infrastructure_logs")
    .select(
      "id, user_id, project_id, event_type, level, severity, message, source, created_at, metadata",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(120);

  let audit: LogRow[] = [];
  if (auditRes.error) {
    if (!isMissingTableError(auditRes.error.message)) {
      errors.push(`infrastructure_logs: ${auditRes.error.message}`);
    }
  } else {
    audit = (auditRes.data ?? []) as LogRow[];
  }

  return {
    workspaces,
    members,
    invites,
    links,
    projects,
    audit,
    errors,
    missingTables,
  };
}

function normalizeRole(raw: string | null | undefined): WorkspaceRole {
  const r = (raw ?? "viewer").toLowerCase();
  if (r === "owner" || r === "admin" || r === "developer" || r === "viewer") {
    return r;
  }
  return "viewer";
}

function normalizeWorkspaceType(raw: string | null | undefined): WorkspaceType {
  const t = (raw ?? "organization").toLowerCase();
  return t === "personal" ? "personal" : "organization";
}

export function TeamClient() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [missingTables, setMissingTables] = useState<string[]>([]);

  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [links, setLinks] = useState<ProjectWorkspaceRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [audit, setAudit] = useState<LogRow[]>([]);

  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const [tab, setTab] = useState<"overview" | "members" | "access" | "settings">(
    "overview",
  );

  const [toast, setToast] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const flashToast = useCallback(
    (tone: "success" | "error" | "info", text: string) => {
      setToast({ tone, text });
      window.setTimeout(() => setToast(null), 3200);
    },
    [],
  );

  const refresh = useCallback(
    async (userId: string, mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const data = await loadTeamData(userId);
        setLoadErrors(data.errors);
        setMissingTables(data.missingTables);
        setWorkspaces(data.workspaces);
        setMembers(data.members);
        setInvites(data.invites);
        setLinks(data.links);
        setProjects(data.projects);
        setAudit(data.audit);

        const memberIds = Array.from(
          new Set(
            data.members
              .map((m) => m.user_id)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          ),
        );

        const ownerIds = Array.from(
          new Set(
            data.workspaces
              .map((w) => w.owner_id)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          ),
        );

        const inviteInviterIds = Array.from(
          new Set(
            data.invites
              .map((i) => i.invited_by)
              .filter((id): id is string => typeof id === "string" && id.length > 0),
          ),
        );

        const ids = Array.from(
          new Set([...memberIds, ...ownerIds, ...inviteInviterIds, userId]),
        );

        if (ids.length > 0) {
          const profRes = await supabase
            .from("profiles")
            .select("id, email, full_name, company, avatar_url")
            .in("id", ids);
          if (!profRes.error && profRes.data) {
            const map: Record<string, ProfileRow> = {};
            for (const row of profRes.data as ProfileRow[]) {
              map[row.id] = row;
            }
            setProfiles(map);
          }
        }
      } catch (e) {
        setLoadErrors([
          e instanceof Error ? e.message : "Failed to load team workspaces.",
        ]);
      } finally {
        if (mode === "initial") setLoading(false);
        else setRefreshing(false);
      }
    },
    [],
  );

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
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, newSession) => {
      if (!newSession) {
        router.replace("/login");
        return;
      }
      setSession(newSession);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!session?.user?.id) return;
    void refresh(session.user.id, "initial");
  }, [session?.user?.id, refresh]);

  const userId = session?.user?.id ?? null;
  const userEmail = session?.user?.email ?? null;

  const activeWorkspace = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  }, [activeWorkspaceId, workspaces]);

  const myMembership = useMemo(() => {
    if (!userId || !activeWorkspaceId) return null;
    return (
      members.find(
        (m) => m.workspace_id === activeWorkspaceId && m.user_id === userId,
      ) ?? null
    );
  }, [members, activeWorkspaceId, userId]);

  const myRole = useMemo(
    () => normalizeRole(myMembership?.role ?? null),
    [myMembership?.role],
  );

  const isOwnerByRow = useMemo(() => {
    if (!userId || !activeWorkspace) return false;
    return activeWorkspace.owner_id === userId;
  }, [activeWorkspace, userId]);

  const effectiveRole: WorkspaceRole = useMemo(() => {
    if (isOwnerByRow) return "owner";
    return myRole;
  }, [isOwnerByRow, myRole]);

  const visibleWorkspaces = useMemo(() => {
    if (!userId) return [];
    const memberWorkspaceIds = new Set(
      members.filter((m) => m.user_id === userId).map((m) => m.workspace_id),
    );
    return workspaces.filter(
      (w) => w.owner_id === userId || memberWorkspaceIds.has(w.id),
    );
  }, [workspaces, members, userId]);

  useEffect(() => {
    if (!userId) return;
    if (visibleWorkspaces.length === 0) {
      setActiveWorkspaceId(null);
      return;
    }

    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_ACTIVE_WS)
        : null;

    const preferred =
      stored && visibleWorkspaces.some((w) => w.id === stored)
        ? stored
        : visibleWorkspaces.find((w) => w.owner_id === userId)?.id ??
          visibleWorkspaces[0]?.id ??
          null;

    setActiveWorkspaceId((prev) => {
      if (prev && visibleWorkspaces.some((w) => w.id === prev)) return prev;
      return preferred;
    });
  }, [userId, visibleWorkspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_ACTIVE_WS, activeWorkspaceId);
  }, [activeWorkspaceId]);

  const workspaceMembers = useMemo(() => {
    if (!activeWorkspaceId) return [];
    return members.filter((m) => m.workspace_id === activeWorkspaceId);
  }, [members, activeWorkspaceId]);

  const workspaceInvites = useMemo(() => {
    if (!activeWorkspaceId) return [];
    return invites.filter((i) => i.workspace_id === activeWorkspaceId);
  }, [invites, activeWorkspaceId]);

  const pendingInvites = useMemo(
    () =>
      workspaceInvites.filter((i) => {
        const s = (i.status ?? "pending").toLowerCase();
        return s === "pending" || s === "sent";
      }),
    [workspaceInvites],
  );

  const linkedProjectCount = useMemo(() => {
    if (!activeWorkspaceId) return 0;
    return links.filter((l) => l.workspace_id === activeWorkspaceId).length;
  }, [links, activeWorkspaceId]);

  const workspaceAudit = useMemo(() => {
    if (!activeWorkspaceId) return [];
    return audit.filter((log) => {
      const meta = log.metadata as Record<string, unknown> | undefined;
      const wid =
        typeof meta?.workspace_id === "string" ? meta.workspace_id : null;
      if (wid && wid === activeWorkspaceId) return true;
      const msg = (log.message ?? "").toLowerCase();
      const slug = (activeWorkspace?.slug ?? "").toLowerCase();
      if (slug && msg.includes(slug)) return true;
      const name = (activeWorkspace?.name ?? "").toLowerCase();
      if (name && msg.includes(name)) return true;
      return false;
    });
  }, [audit, activeWorkspaceId, activeWorkspace?.slug, activeWorkspace?.name]);

  const tablesReady =
    !missingTables.includes("workspaces") &&
    !missingTables.includes("workspace_members");

  const can = useCallback(
    (permission: Permission) => hasPermission(effectiveRole, permission),
    [effectiveRole],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createType, setCreateType] = useState<WorkspaceType>("organization");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<Exclude<WorkspaceRole, "owner">>("developer");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [settingsName, setSettingsName] = useState("");
  const [settingsSlug, setSettingsSlug] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspace) return;
    setSettingsName(activeWorkspace.name ?? "");
    setSettingsSlug(activeWorkspace.slug ?? "");
    setSettingsDesc(
      typeof activeWorkspace.description === "string"
        ? activeWorkspace.description
        : "",
    );
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.slug]);

  const handleCreateWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (!tablesReady) {
      flashToast("error", "Workspace tables are not available yet.");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const name = createName.trim();
      if (!name) {
        setCreateError("Workspace name is required.");
        return;
      }
      const slug = createSlug.trim() ? workspaceSlug(createSlug) : workspaceSlug(name);

      const wsPayload: Record<string, unknown> = {
        name,
        slug,
        type: createType,
        owner_id: userId,
        description: null,
      };

      let wsRes = await supabase.from("workspaces").insert(wsPayload).select("*").single();
      if (wsRes.error) {
        const retry = { ...wsPayload };
        delete retry.description;
        wsRes = await supabase.from("workspaces").insert(retry).select("*").single();
      }
      if (wsRes.error) throw wsRes.error;

      const workspace = wsRes.data as WorkspaceRow;

      const memberPayload: Record<string, unknown> = {
        workspace_id: workspace.id,
        user_id: userId,
        role: "owner",
      };

      let memRes = await supabase.from("workspace_members").insert(memberPayload);
      if (memRes.error) {
        const retry = { ...memberPayload };
        delete retry.updated_at;
        memRes = await supabase.from("workspace_members").insert(retry);
      }
      if (memRes.error) throw memRes.error;

      await insertInfraLog(
        userId,
        "workspace_created",
        `Workspace "${workspace.name ?? slug}" created (${workspace.type ?? createType}).`,
        "info",
        { workspace_id: workspace.id, slug },
      );

      flashToast("success", "Workspace created.");
      setCreateOpen(false);
      setCreateName("");
      setCreateSlug("");
      setCreateType("organization");
      await refresh(userId, "refresh");
      setActiveWorkspaceId(workspace.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setCreateBusy(false);
    }
  };

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId || !activeWorkspaceId) return;
    if (!can("invite_members")) {
      flashToast("error", "You do not have permission to invite members.");
      return;
    }
    if (missingTables.includes("workspace_invitations")) {
      flashToast("error", "Invitations table is not available.");
      return;
    }

    setInviteBusy(true);
    setInviteError(null);
    try {
      const email = inviteEmail.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        setInviteError("Enter a valid email address.");
        return;
      }

      const token = generateInviteToken();
      const payload: Record<string, unknown> = {
        workspace_id: activeWorkspaceId,
        email,
        role: inviteRole,
        token,
        invited_by: userId,
        status: "pending",
      };

      let res = await supabase.from("workspace_invitations").insert(payload);
      if (res.error) {
        const retry = { ...payload };
        delete retry.expires_at;
        res = await supabase.from("workspace_invitations").insert(retry);
      }
      if (res.error) throw res.error;

      await insertInfraLog(
        userId,
        "workspace_invite_sent",
        `Invitation sent to ${email} as ${inviteRole}.`,
        "info",
        {
          workspace_id: activeWorkspaceId,
          email,
          role: inviteRole,
          token_preview: token.slice(0, 6),
        },
      );

      flashToast("success", "Invitation created.");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("developer");
      await refresh(userId, "refresh");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviteBusy(false);
    }
  };

  const handleRevokeInvite = async (invite: InviteRow) => {
    if (!userId) return;
    if (!can("invite_members")) {
      flashToast("error", "You do not have permission to revoke invitations.");
      return;
    }
    const res = await supabase
      .from("workspace_invitations")
      .update({ status: "revoked" })
      .eq("id", invite.id);
    if (res.error) {
      flashToast("error", res.error.message);
      return;
    }
    await insertInfraLog(
      userId,
      "workspace_invite_revoked",
      `Invitation revoked for ${invite.email ?? "unknown email"}.`,
      "warn",
      { workspace_id: invite.workspace_id, invite_id: invite.id },
    );
    flashToast("info", "Invitation revoked.");
    await refresh(userId, "refresh");
  };

  const handleRemoveMember = async () => {
    if (!userId || !removeTarget?.id) return;
    if (!can("remove_members")) {
      flashToast("error", "You do not have permission to remove members.");
      return;
    }
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const res = await supabase.from("workspace_members").delete().eq("id", removeTarget.id);
      if (res.error) throw res.error;
      await insertInfraLog(
        userId,
        "workspace_member_removed",
        `Member removed from workspace (${removeTarget.user_id}).`,
        "warn",
        { workspace_id: removeTarget.workspace_id, member_id: removeTarget.id },
      );
      flashToast("success", "Member removed.");
      setRemoveTarget(null);
      await refresh(userId, "refresh");
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setRemoveBusy(false);
    }
  };

  const handleChangeRole = async (member: MemberRow, next: WorkspaceRole) => {
    if (!userId) return;
    if (!can("change_member_roles")) {
      flashToast("error", "You do not have permission to change roles.");
      return;
    }
    const current = normalizeRole(member.role);
    if (!canActOnRole(effectiveRole, current)) {
      flashToast("error", "You cannot modify this member.");
      return;
    }
    if (next === "owner") {
      flashToast("error", "Use transfer ownership to promote an owner.");
      return;
    }

    const res = await supabase
      .from("workspace_members")
      .update({ role: next })
      .eq("id", member.id);

    if (res.error) {
      const retry = await supabase
        .from("workspace_members")
        .update({ role: next })
        .eq("id", member.id);
      if (retry.error) {
        flashToast("error", retry.error.message);
        return;
      }
    }

    await insertInfraLog(
      userId,
      "workspace_role_changed",
      `Member role updated to ${next}.`,
      "info",
      { workspace_id: member.workspace_id, member_id: member.id, role: next },
    );
    flashToast("success", "Role updated.");
    await refresh(userId, "refresh");
  };

  const handleTransferOwnership = async () => {
    if (!userId || !activeWorkspaceId || !activeWorkspace) return;
    if (!can("transfer_ownership")) {
      flashToast("error", "Only the workspace owner can transfer ownership.");
      return;
    }
    if (!transferTargetId) {
      setTransferError("Select a member to receive ownership.");
      return;
    }

    setTransferBusy(true);
    setTransferError(null);
    try {
      const targetMember = workspaceMembers.find(
        (m) => m.user_id === transferTargetId,
      );
      if (!targetMember?.user_id) throw new Error("Target member not found.");

      const wsUpdate: Record<string, unknown> = {
        owner_id: targetMember.user_id,
      };

      let wsRes = await supabase
        .from("workspaces")
        .update(wsUpdate)
        .eq("id", activeWorkspaceId);
      if (wsRes.error) throw wsRes.error;

      // Normalize member roles so there is exactly one `owner` row that matches
      // the new workspace owner_id.
      for (const m of workspaceMembers) {
        if (!m.user_id) continue;

        let nextRole: WorkspaceRole;
        if (m.user_id === targetMember.user_id) nextRole = "owner";
        else if (m.user_id === userId) nextRole = "admin";
        else {
          const current = normalizeRole(m.role);
          nextRole = current === "owner" ? "admin" : current;
        }

        const res = await supabase
          .from("workspace_members")
          .update({ role: nextRole })
          .eq("id", m.id);
        if (res.error) {
          const retry = await supabase
            .from("workspace_members")
            .update({ role: nextRole })
            .eq("id", m.id);
          if (retry.error) throw retry.error;
        }
      }

      await insertInfraLog(
        userId,
        "workspace_ownership_transferred",
        `Ownership transferred to ${targetMember.user_id}.`,
        "warn",
        {
          workspace_id: activeWorkspaceId,
          previous_owner: userId,
          new_owner: targetMember.user_id,
        },
      );

      flashToast("success", "Ownership transferred.");
      setTransferOpen(false);
      setTransferTargetId("");
      await refresh(userId, "refresh");
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setTransferBusy(false);
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId || !activeWorkspaceId) return;
    if (!can("manage_workspace")) {
      flashToast("error", "You do not have permission to edit workspace settings.");
      return;
    }
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      const name = settingsName.trim();
      if (!name) {
        setSettingsError("Name is required.");
        return;
      }
      const slug = settingsSlug.trim()
        ? workspaceSlug(settingsSlug)
        : workspaceSlug(name);

      const payload: Record<string, unknown> = {
        name,
        slug,
        description: settingsDesc.trim() || null,
      };

      let res = await supabase
        .from("workspaces")
        .update(payload)
        .eq("id", activeWorkspaceId);
      if (res.error) {
        const retry = { name, slug };
        res = await supabase.from("workspaces").update(retry).eq("id", activeWorkspaceId);
      }
      if (res.error) throw res.error;

      await insertInfraLog(
        userId,
        "workspace_settings_updated",
        `Workspace settings updated for "${name}".`,
        "info",
        { workspace_id: activeWorkspaceId, slug },
      );

      flashToast("success", "Workspace settings saved.");
      await refresh(userId, "refresh");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleLinkProject = async (projectId: string) => {
    if (!userId || !activeWorkspaceId) return;
    if (!can("manage_workspace") && !can("edit_projects")) {
      flashToast("error", "You do not have permission to link projects.");
      return;
    }
    if (missingTables.includes("project_workspaces")) {
      flashToast("error", "project_workspaces table is not available.");
      return;
    }

    const payload: Record<string, unknown> = {
      project_id: projectId,
      workspace_id: activeWorkspaceId,
    };

    let res = await supabase.from("project_workspaces").insert(payload);
    if (res.error) {
      res = await supabase.from("project_workspaces").insert({
        project_id: projectId,
        workspace_id: activeWorkspaceId,
      });
    }
    if (res.error) {
      flashToast("error", res.error.message);
      return;
    }

    await insertInfraLog(
      userId,
      "project_linked_to_workspace",
      `Project ${projectId} linked to workspace.`,
      "info",
      { workspace_id: activeWorkspaceId, project_id: projectId },
    );
    flashToast("success", "Project linked.");
    await refresh(userId, "refresh");
  };

  const handleUnlinkProject = async (linkId: string, projectId: string) => {
    if (!userId) return;
    if (!can("manage_workspace") && !can("edit_projects")) {
      flashToast("error", "You do not have permission to unlink projects.");
      return;
    }
    const res = await supabase.from("project_workspaces").delete().eq("id", linkId);
    if (res.error) {
      flashToast("error", res.error.message);
      return;
    }
    await insertInfraLog(
      userId,
      "project_unlinked_from_workspace",
      `Project ${projectId} unlinked from workspace.`,
      "warn",
      { workspace_id: activeWorkspaceId, project_id: projectId, link_id: linkId },
    );
    flashToast("info", "Project unlinked.");
    await refresh(userId, "refresh");
  };

  const isLoading = session === undefined;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundFX />

      <div className="relative z-10 flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar activeKey="team" userEmail={session?.user?.email ?? null} />

        <main className="flex-1 overflow-x-hidden px-5 py-6 sm:px-8 sm:py-10">
          <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-basil-500/10 text-basil-200 shadow-[0_0_24px_-8px_rgba(111,232,154,0.7)]">
                <UsersIcon className="h-5 w-5" title="Team" />
              </div>
              <div className="leading-tight">
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
                  // team workspaces
                </p>
                <h1 className="text-lg font-semibold tracking-tight md:text-xl">
                  Enterprise team workspaces
                </h1>
                <p className="mt-1 text-xs text-white/55">
                  Personal sandboxes and org-wide control planes — roles, invites,
                  access simulation, and audit trails.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!tablesReady || !userId}
                onClick={() => {
                  if (!tablesReady) return;
                  setCreateOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-500/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <BuildingIcon className="h-4 w-4" title="New workspace" />
                New workspace
              </button>
              <button
                type="button"
                disabled={!userId}
                onClick={() => userId && void refresh(userId, "refresh")}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </header>

          {toast ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                toast.tone === "success"
                  ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
                  : toast.tone === "error"
                  ? "border-red-400/40 bg-red-500/10 text-red-100"
                  : "border-white/10 bg-white/[0.04] text-white/80"
              }`}
            >
              {toast.text}
            </div>
          ) : null}

          {loadErrors.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              {loadErrors.slice(0, 4).map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          ) : null}

          {isLoading || loading ? (
            <div className="mt-10 grid place-items-center rounded-3xl border border-white/10 bg-white/[0.03] p-12 text-xs uppercase tracking-[0.28em] text-white/55">
              Loading workspaces…
            </div>
          ) : !tablesReady ? (
            <div className="mt-8">
              <SchemaSetupCard missing={missingTables} />
            </div>
          ) : visibleWorkspaces.length === 0 ? (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <Card eyebrow="// bootstrap" title="Create your first workspace">
                <p className="text-sm text-white/65">
                  Workspaces isolate projects, members, and audit trails. Start with a
                  personal sandbox or spin up an organization control plane.
                </p>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-500/15"
                >
                  <UserPlusIcon className="h-4 w-4" title="Create" />
                  Create workspace
                </button>
              </Card>
              <SchemaSetupCard missing={missingTables} compact />
            </div>
          ) : (
            <div className="mt-8 space-y-6">
              <WorkspaceSwitcher
                workspaces={visibleWorkspaces}
                activeId={activeWorkspaceId}
                onSelect={(id) => {
                  setActiveWorkspaceId(id);
                  setSwitcherOpen(false);
                }}
                open={switcherOpen}
                onToggle={() => setSwitcherOpen((v) => !v)}
                profiles={profiles}
                linkedCount={linkedProjectCount}
                myRole={effectiveRole}
              />

              <TabBar tab={tab} onTab={setTab} />

              {tab === "overview" ? (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                  <div className="space-y-6 xl:col-span-2">
                    <Card
                      eyebrow="// workspace"
                      title={activeWorkspace?.name ?? "Workspace"}
                      description={
                        normalizeWorkspaceType(activeWorkspace?.type ?? null) ===
                        "personal"
                          ? "Personal workspace — private by default, ideal for experiments."
                          : "Organization workspace — shared projects, RBAC, and audit-grade controls."
                      }
                      right={<WorkspaceTypeBadge type={activeWorkspace?.type ?? null} />}
                    >
                      <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                            Slug
                          </dt>
                          <dd className="mt-1 font-mono text-white/85">
                            {activeWorkspace?.slug ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                            Members
                          </dt>
                          <dd className="mt-1 font-mono text-white/85">
                            {workspaceMembers.length}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                            Linked projects
                          </dt>
                          <dd className="mt-1 font-mono text-white/85">
                            {linkedProjectCount}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                            Your role
                          </dt>
                          <dd className="mt-1">
                            <RolePill role={effectiveRole} />
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-6 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!can("invite_members")}
                          onClick={() => setInviteOpen(true)}
                          className="inline-flex items-center gap-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-500/15 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <MailIcon className="h-4 w-4" title="Invite" />
                          Invite member
                        </button>
                        <button
                          type="button"
                          disabled={!can("transfer_ownership")}
                          onClick={() => {
                            setTransferTargetId("");
                            setTransferError(null);
                            setTransferOpen(true);
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100 transition-colors hover:border-amber-300/60 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <CrownIcon className="h-4 w-4" title="Transfer" />
                          Transfer ownership
                        </button>
                      </div>
                    </Card>

                    <Card eyebrow="// projects" title="Project linkage" compact>
                      <ProjectLinker
                        projects={projects}
                        links={links}
                        workspaceId={activeWorkspaceId}
                        canManage={can("manage_workspace") || can("edit_projects")}
                        onLink={handleLinkProject}
                        onUnlink={handleUnlinkProject}
                        missingTable={missingTables.includes("project_workspaces")}
                      />
                    </Card>
                  </div>

                  <div className="space-y-6">
                    <Card eyebrow="// invites" title="Pending invitations" compact>
                      {pendingInvites.length === 0 ? (
                        <p className="text-xs text-white/50">
                          No pending invitations. Operators with invite permissions can
                          bring collaborators into this workspace.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {pendingInvites.map((inv) => (
                            <li
                              key={inv.id}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm text-white/85">
                                  {inv.email}
                                </p>
                                <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                                  {shortTime(inv.created_at)} · token{" "}
                                  <span className="font-mono text-white/55">
                                    {inv.token?.slice(0, 6)}…
                                  </span>
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <RolePill role={normalizeRole(inv.role)} />
                                <button
                                  type="button"
                                  disabled={!can("invite_members")}
                                  onClick={() => void handleRevokeInvite(inv)}
                                  className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/60 transition-colors hover:border-red-400/40 hover:text-red-100 disabled:opacity-35"
                                >
                                  Revoke
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>

                    <Card eyebrow="// activity" title="Workspace audit" compact>
                      <AuditTimeline logs={workspaceAudit} profiles={profiles} />
                    </Card>
                  </div>
                </div>
              ) : null}

              {tab === "members" ? (
                <Card eyebrow="// members" title="Members & roles">
                  <MembersTable
                    members={workspaceMembers}
                    profiles={profiles}
                    currentUserId={userId}
                    actorRole={effectiveRole}
                    onRemove={(m) => {
                      if (!can("remove_members")) {
                        flashToast("error", "You cannot remove members.");
                        return;
                      }
                      const targetRole = normalizeRole(m.role);
                      if (!canActOnRole(effectiveRole, targetRole)) {
                        flashToast("error", "You cannot remove this member.");
                        return;
                      }
                      setRemoveTarget(m);
                    }}
                    onChangeRole={(m, role) => void handleChangeRole(m, role)}
                  />
                </Card>
              ) : null}

              {tab === "access" ? (
                <AccessSimulation actorRole={effectiveRole} userEmail={userEmail} />
              ) : null}

              {tab === "settings" ? (
                <Card eyebrow="// settings" title="Workspace settings">
                  {!can("manage_workspace") ? (
                    <p className="text-sm text-white/60">
                      Only owners and admins can edit workspace metadata.
                    </p>
                  ) : (
                    <form onSubmit={handleSaveSettings} className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
                          Display name
                          <input
                            className={`${inputClass} mt-2`}
                            value={settingsName}
                            onChange={(e) => setSettingsName(e.target.value)}
                          />
                        </label>
                        <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
                          Slug
                          <input
                            className={`${inputClass} mt-2`}
                            value={settingsSlug}
                            onChange={(e) => setSettingsSlug(e.target.value)}
                          />
                        </label>
                      </div>
                      <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
                        Description
                        <textarea
                          className={`${inputClass} mt-2 min-h-[96px] resize-y`}
                          value={settingsDesc}
                          onChange={(e) => setSettingsDesc(e.target.value)}
                        />
                      </label>
                      {settingsError ? (
                        <p className="text-xs text-red-200">{settingsError}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={settingsBusy}
                          className="inline-flex items-center gap-2 rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 transition-colors hover:border-basil-300/60 hover:bg-basil-500/15 disabled:opacity-40"
                        >
                          {settingsBusy ? "Saving…" : "Save changes"}
                        </button>
                      </div>
                    </form>
                  )}
                </Card>
              ) : null}
            </div>
          )}
        </main>
      </div>

      {createOpen ? (
        <Modal title="Create workspace" onClose={() => setCreateOpen(false)}>
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
              Name
              <input
                className={`${inputClass} mt-2`}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Acme Platform"
              />
            </label>
            <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
              Slug (optional)
              <input
                className={`${inputClass} mt-2`}
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
                placeholder="acme-platform"
              />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-xs uppercase tracking-[0.18em] text-white/45">
                Workspace type
              </legend>
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="radio"
                  name="ws-type"
                  checked={createType === "personal"}
                  onChange={() => setCreateType("personal")}
                />
                Personal — private sandbox tied to you as owner.
              </label>
              <label className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="radio"
                  name="ws-type"
                  checked={createType === "organization"}
                  onChange={() => setCreateType("organization")}
                />
                Organization — shared control plane with RBAC and audit trails.
              </label>
            </fieldset>
            {createError ? <p className="text-xs text-red-200">{createError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 hover:border-white/20"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createBusy}
                className="rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 hover:border-basil-300/60 disabled:opacity-40"
              >
                {createBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {inviteOpen ? (
        <Modal title="Invite teammate" onClose={() => setInviteOpen(false)}>
          <form onSubmit={handleInvite} className="space-y-4">
            <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
              Email
              <input
                type="email"
                className={`${inputClass} mt-2`}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="ada@company.com"
              />
            </label>
            <label className="block text-xs uppercase tracking-[0.18em] text-white/45">
              Role
              <select
                className={`${inputClass} mt-2`}
                value={inviteRole}
                onChange={(e) =>
                  setInviteRole(e.target.value as Exclude<WorkspaceRole, "owner">)
                }
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-white/50">
              Simulated invitation — generates a secure token row in{" "}
              <span className="font-mono text-white/70">workspace_invitations</span>.
              Email delivery is not wired yet.
            </p>
            {inviteError ? <p className="text-xs text-red-200">{inviteError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 hover:border-white/20"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={inviteBusy}
                className="rounded-full border border-basil-400/40 bg-basil-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-basil-100 hover:border-basil-300/60 disabled:opacity-40"
              >
                {inviteBusy ? "Sending…" : "Create invite"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      <ConfirmModal
        open={Boolean(removeTarget)}
        title="Remove member?"
        description="They will immediately lose access to this workspace and linked project scopes."
        confirmLabel="Remove"
        destructive
        busy={removeBusy}
        error={removeError}
        onClose={() => {
          setRemoveTarget(null);
          setRemoveError(null);
        }}
        onConfirm={() => void handleRemoveMember()}
      />

      {transferOpen ? (
        <Modal title="Transfer ownership" onClose={() => setTransferOpen(false)}>
          <p className="text-sm text-white/65">
            Select a member to become the new owner. You will be downgraded to{" "}
            <span className="font-semibold text-basil-200">admin</span> after the
            transfer completes.
          </p>
          <label className="mt-4 block text-xs uppercase tracking-[0.18em] text-white/45">
            New owner
            <select
              className={`${inputClass} mt-2`}
              value={transferTargetId}
              onChange={(e) => setTransferTargetId(e.target.value)}
            >
              <option value="">Select member…</option>
              {workspaceMembers
                .filter((m) => m.user_id && m.user_id !== userId)
                .map((m) => (
                  <option key={m.id} value={m.user_id ?? ""}>
                    {profiles[m.user_id ?? ""]?.full_name ??
                      profiles[m.user_id ?? ""]?.email ??
                      m.user_id}
                  </option>
                ))}
            </select>
          </label>
          {transferError ? (
            <p className="mt-2 text-xs text-red-200">{transferError}</p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTransferOpen(false)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 hover:border-white/20"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={transferBusy}
              onClick={() => void handleTransferOwnership()}
              className="rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100 hover:border-amber-300/60 disabled:opacity-40"
            >
              {transferBusy ? "Transferring…" : "Transfer"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function BackgroundFX() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 45% at 85% -10%, rgba(111,232,154,0.10) 0%, transparent 60%), radial-gradient(40% 40% at 5% 110%, rgba(111,232,154,0.06) 0%, transparent 70%), radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.02) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 65% 55% at 50% 25%, black, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 65% 55% at 50% 25%, black, transparent 78%)",
        }}
      />
    </>
  );
}

function Card({
  eyebrow,
  title,
  description,
  right,
  children,
  compact,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent backdrop-blur-2xl ${
        compact ? "p-5" : "p-6"
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {eyebrow ? (
            <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-base font-semibold tracking-tight text-white md:text-lg">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-xs text-white/55">{description}</p>
          ) : null}
        </div>
        {right}
      </div>
      <div className={compact ? "mt-4" : "mt-6"}>{children}</div>
    </section>
  );
}

function WorkspaceTypeBadge({ type }: { type: string | null | undefined }) {
  const t = normalizeWorkspaceType(type);
  const isPersonal = t === "personal";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
        isPersonal
          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
          : "border-basil-400/40 bg-basil-500/10 text-basil-100"
      }`}
    >
      {isPersonal ? "Personal" : "Organization"}
    </span>
  );
}

function TabBar({
  tab,
  onTab,
}: {
  tab: "overview" | "members" | "access" | "settings";
  onTab: (t: "overview" | "members" | "access" | "settings") => void;
}) {
  const items: { id: typeof tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "members", label: "Members" },
    { id: "access", label: "Access simulation" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <div className="flex flex-wrap gap-2 rounded-full border border-white/10 bg-black/40 p-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTab(item.id)}
          className={`rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
            tab === item.id
              ? "bg-basil-500/20 text-basil-100"
              : "text-white/55 hover:text-white"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  open,
  onToggle,
  profiles,
  linkedCount,
  myRole,
}: {
  workspaces: WorkspaceRow[];
  activeId: string | null;
  onSelect: (id: string) => void;
  open: boolean;
  onToggle: () => void;
  profiles: Record<string, ProfileRow>;
  linkedCount: number;
  myRole: WorkspaceRole;
}) {
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const ownerProfile = active?.owner_id ? profiles[active.owner_id] : undefined;
  const ownerTone = avatarTone(active?.owner_id ?? "owner");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 rounded-3xl border border-white/10 bg-gradient-to-r from-white/[0.06] via-white/[0.03] to-transparent px-5 py-4 text-left transition-colors hover:border-basil-400/30"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-2 ${ownerTone.ring} ${ownerTone.background}`}
          >
            <span className={`text-sm font-semibold ${ownerTone.text}`}>
              {initialsFromIdentity(ownerProfile?.full_name, ownerProfile?.email)}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {active?.name ?? "Workspace"}
            </p>
            <p className="truncate text-xs text-white/50">
              <span className="font-mono text-white/65">{active?.slug}</span>
              <span className="mx-2 text-white/25">·</span>
              {linkedCount} linked projects
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <RolePill role={myRole} />
          <ChevronDownIcon
            className={`h-4 w-4 text-white/55 transition-transform ${open ? "rotate-180" : ""}`}
            title="Toggle workspaces"
          />
        </div>
      </button>

      {open ? (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-black/90 shadow-[0_24px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto">
            {workspaces.map((w) => {
              const selected = w.id === active?.id;
              const p = w.owner_id ? profiles[w.owner_id] : undefined;
              const tone = avatarTone(w.owner_id ?? w.id);
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(w.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                      selected ? "bg-basil-500/10" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <div
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-2 ${tone.ring} ${tone.background}`}
                    >
                      <span className={`text-xs font-semibold ${tone.text}`}>
                        {initialsFromIdentity(p?.full_name, p?.email)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{w.name}</p>
                      <p className="truncate text-xs text-white/45">
                        <span className="font-mono text-white/60">{w.slug}</span>
                        <span className="mx-2 text-white/25">·</span>
                        <WorkspaceTypeBadge type={w.type} />
                      </p>
                    </div>
                    {selected ? (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-basil-200">
                        Active
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RolePill({ role }: { role: WorkspaceRole | string }) {
  const r = normalizeRole(typeof role === "string" ? role : role);
  const st = roleStyle(r);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${st.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
      {roleLabel(r)}
    </span>
  );
}

function MembersTable({
  members,
  profiles,
  currentUserId,
  actorRole,
  onRemove,
  onChangeRole,
}: {
  members: MemberRow[];
  profiles: Record<string, ProfileRow>;
  currentUserId: string | null;
  actorRole: WorkspaceRole;
  onRemove: (m: MemberRow) => void;
  onChangeRole: (m: MemberRow, role: WorkspaceRole) => void;
}) {
  const sorted = useMemo(() => {
    return [...members].sort((a, b) => {
      const ra = normalizeRole(a.role);
      const rb = normalizeRole(b.role);
      if (ra === rb) {
        return (
          new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
        );
      }
      const rank: Record<WorkspaceRole, number> = {
        owner: 4,
        admin: 3,
        developer: 2,
        viewer: 1,
      };
      return rank[rb] - rank[ra];
    });
  }, [members]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/35">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-white/5 text-sm">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-[0.18em] text-white/45">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Member</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Joined</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sorted.map((m) => {
              const prof = m.user_id ? profiles[m.user_id] : undefined;
              const initials = initialsFromIdentity(prof?.full_name, prof?.email);
              const tone = avatarTone(m.user_id ?? m.id);
              const role = normalizeRole(m.role);
              const isSelf = m.user_id && m.user_id === currentUserId;
              const canModify = hasPermission(actorRole, "change_member_roles");
              const canRemove = hasPermission(actorRole, "remove_members");
              const targetRemovable = canActOnRole(actorRole, role) && !isSelf;

              return (
                <tr key={m.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-2 ${tone.ring} ${tone.background}`}
                      >
                        <span className={`text-xs font-semibold ${tone.text}`}>
                          {initials}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">
                          {prof?.full_name ?? "Unknown member"}
                        </p>
                        <p className="truncate text-xs text-white/50">
                          {prof?.email ?? m.user_id ?? "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <RolePill role={role} />
                      {canModify && targetRemovable && role !== "owner" ? (
                        <select
                          className="max-w-[200px] rounded-xl border border-white/10 bg-black/50 px-2 py-1 text-xs text-white/80 outline-none focus:border-basil-400/40"
                          value={role}
                          onChange={(e) =>
                            onChangeRole(m, normalizeRole(e.target.value))
                          }
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      ) : role === "owner" ? (
                        <p className="text-[11px] text-white/45">
                          Transfer ownership to promote another owner.
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/55">
                    {shortTime(m.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={!canRemove || !targetRemovable}
                      onClick={() => onRemove(m)}
                      className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 transition-colors hover:border-red-400/40 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      Remove
                    </button>
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

const PERMISSION_MATRIX: { key: Permission; label: string; hint: string }[] = [
  {
    key: "manage_workspace",
    label: "Manage workspace",
    hint: "Rename, metadata, linkage controls.",
  },
  {
    key: "invite_members",
    label: "Invite members",
    hint: "Create invitations & onboard collaborators.",
  },
  {
    key: "remove_members",
    label: "Remove members",
    hint: "Revoke access immediately.",
  },
  {
    key: "change_member_roles",
    label: "Change roles",
    hint: "Promote / demote within policy guardrails.",
  },
  {
    key: "transfer_ownership",
    label: "Transfer ownership",
    hint: "Hand off the crown — irreversible without another transfer.",
  },
  {
    key: "view_audit",
    label: "View audit trail",
    hint: "Workspace-scoped infrastructure events.",
  },
  {
    key: "deploy_projects",
    label: "Trigger deployments",
    hint: "Ship to edge from linked projects.",
  },
  {
    key: "edit_projects",
    label: "Edit projects",
    hint: "Change repo URLs, env, build settings.",
  },
  {
    key: "view_projects",
    label: "View projects",
    hint: "Read-only access to linked projects.",
  },
];

function AccessSimulation({
  actorRole,
  userEmail,
}: {
  actorRole: WorkspaceRole;
  userEmail: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card
        eyebrow="// rbac"
        title="Permissions simulation"
        description={`Evaluated for your effective workspace role: ${roleLabel(actorRole)}.`}
        compact
        right={<RolePill role={actorRole} />}
      >
        <ul className="space-y-2">
          {PERMISSION_MATRIX.map((row) => {
            const allowed = hasPermission(actorRole, row.key);
            return (
              <li
                key={row.key}
                className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-white/90">{row.label}</p>
                  <p className="text-xs text-white/45">{row.hint}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    allowed
                      ? "border-basil-400/40 bg-basil-500/10 text-basil-100"
                      : "border-white/10 bg-black/40 text-white/45"
                  }`}
                >
                  {allowed ? "allowed" : "denied"}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        eyebrow="// operator"
        title="Session context"
        description="How GTLNAV evaluates your workspace session today."
        compact
      >
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">
              Actor email
            </dt>
            <dd className="mt-1 font-mono text-xs text-white/80">{userEmail ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.2em] text-white/45">
              Enforcement
            </dt>
            <dd className="mt-1 text-xs text-white/65">
              UI gates mirror the role matrix in{" "}
              <span className="font-mono text-white/80">workspace-permissions.ts</span>.
              Row-level security still needs matching Supabase policies for production
              hardening.
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        eyebrow="// guidance"
        title="Role design notes"
        description="How each role is intended to behave inside an organization workspace."
        compact
      >
        <ul className="space-y-2 text-xs text-white/60">
          <li>
            <span className="font-semibold text-amber-200">Owner</span> — full control,
            can transfer ownership, delete workspace (future), and override every gate.
          </li>
          <li>
            <span className="font-semibold text-basil-200">Admin</span> — operational
            super-user: invites, role changes, audit visibility — but cannot touch another
            admin or the owner.
          </li>
          <li>
            <span className="font-semibold text-cyan-200">Developer</span> — ship lane
            access: edit + deploy linked projects without membership administration.
          </li>
          <li>
            <span className="font-semibold text-white/80">Viewer</span> — read-only
            observability for stakeholders and auditors.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function AuditTimeline({
  logs,
  profiles,
}: {
  logs: LogRow[];
  profiles: Record<string, ProfileRow>;
}) {
  if (logs.length === 0) {
    return (
      <p className="text-xs text-white/50">
        No workspace-scoped audit events yet. Actions like invites, ownership transfers,
        and linkage changes will appear here once logged to{" "}
        <span className="font-mono text-white/70">infrastructure_logs</span>.
      </p>
    );
  }

  return (
    <ol className="relative max-h-[420px] space-y-3 overflow-y-auto pl-4">
      <span
        aria-hidden
        className="absolute left-1 top-1 bottom-1 w-px bg-gradient-to-b from-transparent via-white/15 to-transparent"
      />
      {logs.slice(0, 40).map((log) => {
        const styles = logLevelClasses(logLevel(log));
        const actor = log.user_id ? profiles[log.user_id] : undefined;
        return (
          <li key={log.id} className="relative">
            <span
              className={`absolute -left-[3px] top-1.5 h-2 w-2 rounded-full ${styles.dot}`}
              aria-hidden
            />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-[10px] uppercase tracking-[0.18em] ${styles.label}`}>
                  {log.event_type ?? "event"}
                </span>
                <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                  {shortTime(log.created_at)}
                </span>
              </div>
              <p className="mt-1 text-sm text-white/85">{logMessage(log)}</p>
              {actor ? (
                <p className="mt-1 text-[11px] text-white/45">
                  Actor ·{" "}
                  <span className="text-white/70">
                    {actor.full_name ?? actor.email ?? log.user_id}
                  </span>
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProjectLinker({
  projects,
  links,
  workspaceId,
  canManage,
  onLink,
  onUnlink,
  missingTable,
}: {
  projects: ProjectRow[];
  links: ProjectWorkspaceRow[];
  workspaceId: string | null;
  canManage: boolean;
  onLink: (projectId: string) => void;
  onUnlink: (linkId: string, projectId: string) => void;
  missingTable: boolean;
}) {
  if (!workspaceId) return null;
  if (missingTable) {
    return (
      <p className="text-xs text-white/55">
        The <span className="font-mono text-white/75">project_workspaces</span> join
        table is not available. Apply the SQL from the setup card to link projects to
        this workspace.
      </p>
    );
  }

  const linked = links.filter((l) => l.workspace_id === workspaceId);
  const linkedIds = new Set(linked.map((l) => l.project_id));
  const available = projects.filter((p) => !linkedIds.has(p.id));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
          Linked projects
        </p>
        <ul className="mt-2 space-y-2">
          {linked.length === 0 ? (
            <li className="text-xs text-white/50">No linked projects yet.</li>
          ) : (
            linked.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/85">
                    {projects.find((p) => p.id === l.project_id)?.name ?? l.project_id}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                    {shortTime(l.created_at ?? null)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => onUnlink(l.id, l.project_id)}
                  className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60 transition-colors hover:border-red-400/40 hover:text-red-100 disabled:opacity-30"
                >
                  Unlink
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
          Available projects
        </p>
        <ul className="mt-2 space-y-2">
          {available.length === 0 ? (
            <li className="text-xs text-white/50">All projects are already linked.</li>
          ) : (
            available.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <p className="truncate text-sm text-white/85">{p.name ?? p.id}</p>
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => onLink(p.id)}
                  className="rounded-full border border-basil-400/40 bg-basil-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-basil-100 transition-colors hover:border-basil-300/60 disabled:opacity-30"
                >
                  Link
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-10 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-950 via-black to-zinc-950 p-6 shadow-[0_0_80px_-20px_rgba(111,232,154,0.35)]">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/60 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function SchemaSetupCard({
  missing,
  compact,
}: {
  missing: string[];
  compact?: boolean;
}) {
  const sql = `-- GTLNAV Team Workspaces (Phase 4C)
-- Run in Supabase SQL editor. Adjust RLS policies for your threat model.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  type text not null default 'organization'
    check (type in ('personal','organization')),
  owner_id uuid not null references auth.users (id) on delete cascade,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner','admin','developer','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role text not null default 'developer'
    check (role in ('admin','developer','viewer')),
  token text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','sent','accepted','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.project_workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, workspace_id)
);

create index if not exists workspace_members_workspace_idx
  on public.workspace_members (workspace_id);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

create index if not exists workspace_invites_workspace_idx
  on public.workspace_invitations (workspace_id);

create index if not exists project_workspaces_workspace_idx
  on public.project_workspaces (workspace_id);
`;

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent backdrop-blur-2xl ${
        compact ? "p-5" : "p-6"
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/40 to-transparent" />
      <h2 className="text-base font-semibold text-white md:text-lg">
        {compact ? "Database setup" : "Enable team workspaces"}
      </h2>
      <p className="mt-2 text-sm text-white/60">
        The following tables were not detected:{" "}
        <span className="font-mono text-white/80">
          {missing.length ? missing.join(", ") : "workspaces, workspace_members, …"}
        </span>
        . Paste the SQL below into Supabase, then refresh this page.
      </p>
      <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl border border-white/10 bg-black/70 p-4 text-[11px] leading-relaxed text-basil-100/90">
        <code>{sql}</code>
      </pre>
    </section>
  );
}
