import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumn, isMissingTable } from "./server-deployments";

if (typeof window !== "undefined") {
  throw new Error(
    "server-projects.ts must only be imported from server runtime — never from a 'use client' component.",
  );
}

export type ProjectRecord = {
  id: string;
  user_id: string;
  owner_id: string;
  name: string | null;
  slug: string | null;
  framework: string | null;
  provider: string | null;
  repo_url: string | null;
  branch: string | null;
  root_directory: string | null;
  build_command: string | null;
  install_command: string | null;
  output_directory: string | null;
  start_command: string | null;
  runtime_kind: string | null;
  hosting_kind: string | null;
  status: string | null;
  live_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type CreateProjectInput = {
  userId: string;
  name: string;
  slug: string;
  framework?: string | null;
  provider?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  rootDirectory?: string | null;
  buildCommand?: string | null;
  installCommand?: string | null;
  outputDirectory?: string | null;
  startCommand?: string | null;
  runtimeKind?: string | null;
  hostingKind?: string | null;
  status?: string | null;
};

const LEGACY_SELECT = [
  "id",
  "user_id",
  "name",
  "slug",
  "framework",
  "provider",
  "repo_url",
  "default_branch",
  "root_directory",
  "build_command",
  "install_command",
  "build_output_dir",
  "start_command",
  "runtime_kind",
  "hosting_kind",
  "status",
  "live_url",
  "created_at",
  "updated_at",
].join(", ");

const RICH_SELECT = [
  "id",
  "user_id",
  "owner_id",
  "name",
  "slug",
  "framework",
  "provider",
  "repo_url",
  "branch",
  "root_directory",
  "build_command",
  "install_command",
  "output_directory",
  "start_command",
  "runtime_kind",
  "hosting_kind",
  "status",
  "live_url",
  "created_at",
  "updated_at",
].join(", ");

const ALLOWED_PROJECT_STATUSES = new Set([
  "idle",
  "deploying",
  "active",
  "paused",
  "failed",
  "error",
  "archived",
]);

const ALLOWED_RUNTIME_KINDS = new Set(["auto", "static", "docker"]);
const ALLOWED_HOSTING_KINDS = new Set(["static", "docker", "unsupported"]);

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function slugifyProjectName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeBranch(value: string | null | undefined): string {
  return stringField(value) ?? "main";
}

function mapProjectRow(row: Record<string, unknown>): ProjectRecord {
  const userId = String(row.user_id ?? "");
  const ownerId = String(row.owner_id ?? row.user_id ?? "");
  return {
    id: String(row.id ?? ""),
    user_id: userId,
    owner_id: ownerId,
    name: stringField(row.name),
    slug: stringField(row.slug),
    framework: stringField(row.framework),
    provider: stringField(row.provider),
    repo_url: stringField(row.repo_url),
    branch: stringField(row.branch) ?? stringField(row.default_branch) ?? "main",
    root_directory: stringField(row.root_directory),
    build_command: stringField(row.build_command),
    install_command: stringField(row.install_command),
    output_directory:
      stringField(row.output_directory) ?? stringField(row.build_output_dir),
    start_command: stringField(row.start_command),
    runtime_kind: stringField(row.runtime_kind),
    hosting_kind: stringField(row.hosting_kind),
    status: stringField(row.status),
    live_url: stringField(row.live_url),
    created_at: stringField(row.created_at),
    updated_at: stringField(row.updated_at),
  };
}

export async function listOwnedProjects(
  client: SupabaseClient,
  userId: string,
): Promise<
  | { ok: true; projects: ProjectRecord[] }
  | { ok: false; status: number; error: string; message: string }
> {
  let res = await client
    .from("projects")
    .select(RICH_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (res.error && isMissingColumn(res.error.message)) {
    res = await client
      .from("projects")
      .select(LEGACY_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
  }

  if (res.error) {
    return {
      ok: false,
      status: isMissingTable(res.error.message) ? 503 : 500,
      error: isMissingTable(res.error.message)
        ? "projects_table_missing"
        : "projects_lookup_failed",
      message: res.error.message,
    };
  }

  return {
    ok: true,
    projects: (((res.data ?? []) as unknown) as Record<string, unknown>[]).map(
      mapProjectRow,
    ),
  };
}

export async function loadOwnedProjectRecord(
  client: SupabaseClient,
  args: { projectId: string; userId: string },
): Promise<
  | { ok: true; project: ProjectRecord }
  | { ok: false; status: number; error: string; message: string }
> {
  let res = await client
    .from("projects")
    .select(RICH_SELECT)
    .eq("id", args.projectId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (res.error && isMissingColumn(res.error.message)) {
    res = await client
      .from("projects")
      .select(LEGACY_SELECT)
      .eq("id", args.projectId)
      .eq("user_id", args.userId)
      .maybeSingle();
  }

  if (res.error) {
    return {
      ok: false,
      status: isMissingTable(res.error.message) ? 503 : 500,
      error: isMissingTable(res.error.message)
        ? "projects_table_missing"
        : "project_lookup_failed",
      message: res.error.message,
    };
  }
  if (!res.data) {
    return {
      ok: false,
      status: 404,
      error: "project_not_found",
      message: "Project not found or not owned by caller.",
    };
  }

  return {
    ok: true,
    project: mapProjectRow((res.data as unknown) as Record<string, unknown>),
  };
}

export async function createOwnedProject(
  client: SupabaseClient,
  input: CreateProjectInput,
): Promise<
  | { ok: true; project: ProjectRecord }
  | { ok: false; status: number; error: string; message: string }
> {
  const name = stringField(input.name);
  const slug = slugifyProjectName(input.slug);

  if (!name) {
    return {
      ok: false,
      status: 400,
      error: "invalid_name",
      message: "name is required.",
    };
  }
  if (!slug) {
    return {
      ok: false,
      status: 400,
      error: "invalid_slug",
      message: "slug must contain at least one alphanumeric character.",
    };
  }

  const status = (stringField(input.status) ?? "idle").toLowerCase();
  if (!ALLOWED_PROJECT_STATUSES.has(status)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_status",
      message: `status must be one of: ${[...ALLOWED_PROJECT_STATUSES].join(", ")}.`,
    };
  }

  const runtimeKind = (stringField(input.runtimeKind) ?? "auto").toLowerCase();
  if (!ALLOWED_RUNTIME_KINDS.has(runtimeKind)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_runtime_kind",
      message: `runtime_kind must be one of: ${[...ALLOWED_RUNTIME_KINDS].join(", ")}.`,
    };
  }

  const hostingKind = (
    stringField(input.hostingKind) ??
    (runtimeKind === "docker" ? "docker" : "static")
  ).toLowerCase();
  if (!ALLOWED_HOSTING_KINDS.has(hostingKind)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_hosting_kind",
      message: `hosting_kind must be one of: ${[...ALLOWED_HOSTING_KINDS].join(", ")}.`,
    };
  }

  const insertable = {
    user_id: input.userId,
    name,
    slug,
    framework: stringField(input.framework),
    provider: stringField(input.provider),
    repo_url: stringField(input.repoUrl),
    default_branch: normalizeBranch(input.branch),
    root_directory: stringField(input.rootDirectory),
    build_command: stringField(input.buildCommand),
    install_command: stringField(input.installCommand),
    build_output_dir: stringField(input.outputDirectory),
    start_command: stringField(input.startCommand),
    runtime_kind: runtimeKind,
    hosting_kind: hostingKind,
    status,
  };

  const { data, error } = await client
    .from("projects")
    .insert(insertable)
    .select(RICH_SELECT)
    .maybeSingle();

  if (error && isMissingColumn(error.message)) {
    const legacy = await client
      .from("projects")
      .insert(insertable)
      .select(LEGACY_SELECT)
      .maybeSingle();
    if (legacy.error) {
      return {
        ok: false,
        status: legacy.error.code === "23505" ? 409 : 500,
        error:
          legacy.error.code === "23505"
            ? "slug_conflict"
            : "project_create_failed",
        message: legacy.error.message,
      };
    }
    return {
      ok: true,
      project: mapProjectRow((legacy.data as unknown) as Record<string, unknown>),
    };
  }

  if (error) {
    return {
      ok: false,
      status: error.code === "23505" ? 409 : 500,
      error: error.code === "23505" ? "slug_conflict" : "project_create_failed",
      message: error.message,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 500,
      error: "project_create_failed",
      message: "Insert succeeded but no project row was returned.",
    };
  }

  return {
    ok: true,
    project: mapProjectRow((data as unknown) as Record<string, unknown>),
  };
}
