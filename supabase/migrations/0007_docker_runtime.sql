-- GTLNAV — Phase 6B migration 0007
-- Docker / SSR runtime support.
--
-- - Adds runtime_kind override on projects so operators can force "static" or
--   "docker" instead of letting the worker auto-detect.
-- - Extends runtime_instances with the columns the worker needs to manage a
--   real container lifecycle.
-- - Adds a control queue for runtime actions (start / stop / restart /
--   destroy). The deployment worker polls the same `deployment_jobs` table,
--   discriminated by `payload.kind`.

-- ---------------------------------------------------------------------------
-- projects.runtime_kind — operator override.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists runtime_kind text not null default 'auto'
    check (runtime_kind in ('auto', 'static', 'docker'));

-- ---------------------------------------------------------------------------
-- runtime_instances — extended.
-- ---------------------------------------------------------------------------
alter table public.runtime_instances
  add column if not exists target_state text not null default 'running'
    check (target_state in ('running', 'stopped', 'destroyed')),
  add column if not exists internal_port int,
  add column if not exists container_id text,
  add column if not exists container_name text,
  add column if not exists image_tag text,
  add column if not exists dockerfile_source text not null default 'detected',
  add column if not exists last_health_status text
    check (last_health_status is null or last_health_status in (
      'unknown', 'starting', 'healthy', 'unhealthy', 'crashed'
    )),
  add column if not exists last_health_check timestamptz,
  add column if not exists last_action text,
  add column if not exists last_action_at timestamptz,
  add column if not exists restart_count int not null default 0,
  add column if not exists exit_code int,
  add column if not exists exit_reason text;

create unique index if not exists runtime_instances_container_name_uidx
  on public.runtime_instances (container_name)
  where container_name is not null;

create index if not exists runtime_instances_target_state_idx
  on public.runtime_instances (target_state);

-- ---------------------------------------------------------------------------
-- domains — ensure pending_ssl / ssl_failed states + ssl_issuer column.
-- The check constraint on ssl_status was already updated in 0004, but old
-- production schemas may still carry the legacy "pending" value. This block
-- is a defensive no-op against newer schemas.
-- ---------------------------------------------------------------------------
alter table public.domains
  add column if not exists ssl_issuer text;

-- ---------------------------------------------------------------------------
-- deployments — record the resolved hosting_kind for this build.
-- ---------------------------------------------------------------------------
alter table public.deployments
  add column if not exists hosting_kind text
    check (hosting_kind is null or hosting_kind in (
      'static', 'docker', 'unsupported'
    ));

-- ---------------------------------------------------------------------------
-- proxy_routes — flattened materialized view of what the proxy should serve.
-- The /api/proxy/route-config endpoint reads this and emits Caddy JSON.
--
-- We use a regular table maintained by the control plane + worker rather
-- than a view, so the proxy can read it with a single index lookup and so
-- workers can write status (last_seen, last_used_at) without recomputing.
-- ---------------------------------------------------------------------------
create table if not exists public.proxy_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  /** "<slug>.<base>" for project routes; verified custom domain otherwise. */
  hostname text not null,
  /** "static" | "docker". */
  upstream_kind text not null
    check (upstream_kind in ('static', 'docker')),
  /** For static: filesystem path served by file_server. */
  serve_path text,
  /** For docker: 127.0.0.1:<port>. */
  upstream_target text,
  /** Currently active runtime_instances.id (if docker). */
  runtime_instance_id uuid references public.runtime_instances(id)
    on delete set null,
  /** Most recent deployments.id this route was published from. */
  deployment_id uuid references public.deployments(id) on delete set null,
  /** "active" | "pending" | "disabled". */
  status text not null default 'active'
    check (status in ('active', 'pending', 'disabled')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists proxy_routes_hostname_uidx
  on public.proxy_routes (lower(hostname));
create index if not exists proxy_routes_project_idx on public.proxy_routes (project_id);
create index if not exists proxy_routes_user_idx on public.proxy_routes (user_id);
create index if not exists proxy_routes_status_idx on public.proxy_routes (status);

alter table public.proxy_routes enable row level security;

drop policy if exists "proxy_routes read own"   on public.proxy_routes;
drop policy if exists "proxy_routes insert own" on public.proxy_routes;
drop policy if exists "proxy_routes update own" on public.proxy_routes;
drop policy if exists "proxy_routes delete own" on public.proxy_routes;

create policy "proxy_routes read own"
  on public.proxy_routes for select
  using (auth.uid() = user_id);

create policy "proxy_routes insert own"
  on public.proxy_routes for insert
  with check (auth.uid() = user_id);

create policy "proxy_routes update own"
  on public.proxy_routes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "proxy_routes delete own"
  on public.proxy_routes for delete
  using (auth.uid() = user_id);
-- The proxy / worker access this table with the service role.
