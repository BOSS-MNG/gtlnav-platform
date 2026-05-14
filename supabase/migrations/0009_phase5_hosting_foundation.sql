-- GTLNAV — Phase 5 Docker SaaS hosting foundation
--
-- This migration is intentionally additive and back-compat friendly:
-- - keeps existing `projects`, `project_envs`, `deployments`, `runtime_instances`,
--   `domains`, and `infrastructure_logs` intact
-- - adds compatibility fields / views expected by the Phase 5 product model
-- - avoids creating a second source of truth where a generated alias is safer

-- ---------------------------------------------------------------------------
-- projects — add Docker SaaS foundation fields.
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists root_directory text,
  add column if not exists start_command text;

-- Compatibility aliases for the Phase 5 naming model. We keep the original
-- physical columns (`user_id`, `default_branch`, `build_output_dir`) because
-- the current worker/control-plane already depend on them.
alter table public.projects
  add column if not exists owner_id uuid
    generated always as (user_id) stored,
  add column if not exists branch text
    generated always as (coalesce(default_branch, 'main')) stored,
  add column if not exists output_directory text
    generated always as (build_output_dir) stored;

create index if not exists projects_default_branch_idx
  on public.projects (default_branch);

-- ---------------------------------------------------------------------------
-- project environments — compatibility views over the existing `project_envs`
-- table so newer UI/API surfaces can refer to either naming convention without
-- creating split-brain writes.
-- ---------------------------------------------------------------------------
create or replace view public.project_environments as
select
  id,
  user_id,
  project_id,
  key,
  value,
  scope as environment,
  is_secret,
  created_at,
  updated_at
from public.project_envs;

create or replace view public.project_environment_variables as
select
  id,
  user_id,
  project_id,
  key,
  value,
  scope as environment,
  is_secret,
  created_at,
  updated_at
from public.project_envs;

-- ---------------------------------------------------------------------------
-- runtime_instances — add Phase 5 alias/runtime fields.
-- ---------------------------------------------------------------------------
alter table public.runtime_instances
  add column if not exists docker_image text
    generated always as (image_tag) stored,
  add column if not exists external_port int,
  add column if not exists runtime_status text
    generated always as (status) stored,
  add column if not exists health_status text
    generated always as (coalesce(last_health_status, 'unknown')) stored;

create index if not exists runtime_instances_runtime_status_idx
  on public.runtime_instances (runtime_status);

create index if not exists runtime_instances_health_status_idx
  on public.runtime_instances (health_status);

-- ---------------------------------------------------------------------------
-- deployment_logs — foundation table for structured deployment/runtime log
-- streams. Existing production paths still use `infrastructure_logs`, so this
-- table starts as a forward-looking store for richer per-deployment tails.
-- ---------------------------------------------------------------------------
create table if not exists public.deployment_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  deployment_id uuid references public.deployments(id) on delete cascade,
  runtime_instance_id uuid references public.runtime_instances(id) on delete set null,
  source text not null default 'system',
  level text not null default 'info'
    check (level in ('debug', 'info', 'notice', 'warning', 'warn', 'error', 'success', 'critical')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deployment_logs_user_idx
  on public.deployment_logs (user_id, created_at desc);
create index if not exists deployment_logs_project_idx
  on public.deployment_logs (project_id, created_at desc);
create index if not exists deployment_logs_deployment_idx
  on public.deployment_logs (deployment_id, created_at desc);
create index if not exists deployment_logs_runtime_instance_idx
  on public.deployment_logs (runtime_instance_id, created_at desc);

alter table public.deployment_logs enable row level security;

drop policy if exists "deployment_logs read own" on public.deployment_logs;
drop policy if exists "deployment_logs insert own" on public.deployment_logs;
drop policy if exists "deployment_logs update own" on public.deployment_logs;
drop policy if exists "deployment_logs delete own" on public.deployment_logs;

create policy "deployment_logs read own"
  on public.deployment_logs for select
  using (auth.uid() = user_id);

create policy "deployment_logs insert own"
  on public.deployment_logs for insert
  with check (auth.uid() = user_id);

create policy "deployment_logs update own"
  on public.deployment_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "deployment_logs delete own"
  on public.deployment_logs for delete
  using (auth.uid() = user_id);
