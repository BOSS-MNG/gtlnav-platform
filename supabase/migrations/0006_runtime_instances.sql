-- GTLNAV — Phase 6A migration 0006
-- Real runtime instances served by the static host / Caddy / future docker.
--
-- `runtime_instances` is the row a worker writes when a deployment goes live.
-- The dashboard reads this for "what is currently running" and which URL to
-- show the user.

create table if not exists public.runtime_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  deployment_id uuid references public.deployments(id) on delete set null,
  /** "static" is the only kind supported in Phase 6A. "docker" is reserved. */
  runtime_kind text not null default 'static'
    check (runtime_kind in ('static', 'docker')),
  status text not null default 'pending'
    check (status in ('pending', 'starting', 'running', 'stopped', 'failed')),
  /** Public URL the worker / proxy assigned to this instance. */
  public_url text,
  /** Subdomain slug under GTLNAV_DEPLOY_BASE_DOMAIN. */
  subdomain text,
  /** Filesystem path or container id depending on runtime_kind. */
  serve_path text,
  /** Worker label that last published this instance. */
  served_by text,
  last_started_at timestamptz,
  last_stopped_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists runtime_instances_project_active
  on public.runtime_instances (project_id)
  where status in ('running', 'starting');

create index if not exists runtime_instances_user_idx
  on public.runtime_instances (user_id);
create index if not exists runtime_instances_status_idx
  on public.runtime_instances (status);
create index if not exists runtime_instances_deployment_idx
  on public.runtime_instances (deployment_id);

alter table public.runtime_instances enable row level security;

drop policy if exists "runtime_instances read own"   on public.runtime_instances;
drop policy if exists "runtime_instances insert own" on public.runtime_instances;
drop policy if exists "runtime_instances update own" on public.runtime_instances;

create policy "runtime_instances read own"
  on public.runtime_instances for select
  using (auth.uid() = user_id);

create policy "runtime_instances insert own"
  on public.runtime_instances for insert
  with check (auth.uid() = user_id);

create policy "runtime_instances update own"
  on public.runtime_instances for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Workers run with the service role and bypass RLS.
