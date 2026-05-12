-- GTLNAV — Phase 6A migration 0002
-- Projects + project env vars.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  framework text,
  provider text,
  repo_url text,
  default_branch text,
  status text not null default 'idle'
    check (status in (
      'idle', 'deploying', 'active', 'paused', 'failed', 'error', 'archived'
    )),
  live_url text,
  /** When set, the deploy worker should serve this commit as the current live URL. */
  current_deployment_id uuid,
  build_command text,
  build_output_dir text,
  install_command text,
  node_version text,
  /** Hosting kind chosen for this project. v1 supports only 'static'. */
  hosting_kind text not null default 'static'
    check (hosting_kind in ('static', 'docker', 'unsupported')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projects_user_slug_uidx
  on public.projects (user_id, lower(slug));
create index if not exists projects_user_idx on public.projects (user_id);
create index if not exists projects_status_idx on public.projects (status);

alter table public.projects enable row level security;

drop policy if exists "projects read own"   on public.projects;
drop policy if exists "projects insert own" on public.projects;
drop policy if exists "projects update own" on public.projects;
drop policy if exists "projects delete own" on public.projects;

create policy "projects read own"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "projects insert own"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "projects update own"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "projects delete own"
  on public.projects for delete
  using (auth.uid() = user_id);

-- Per-project environment variables.
create table if not exists public.project_envs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  key text not null,
  value text,
  /** When true, the dashboard masks the value and the worker does NOT log it. */
  is_secret boolean not null default false,
  scope text not null default 'build_and_runtime'
    check (scope in ('build_only', 'runtime_only', 'build_and_runtime')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_envs_unique_key
  on public.project_envs (project_id, key);
create index if not exists project_envs_user_idx on public.project_envs (user_id);

alter table public.project_envs enable row level security;

drop policy if exists "project_envs read own"   on public.project_envs;
drop policy if exists "project_envs insert own" on public.project_envs;
drop policy if exists "project_envs update own" on public.project_envs;
drop policy if exists "project_envs delete own" on public.project_envs;

create policy "project_envs read own"
  on public.project_envs for select
  using (auth.uid() = user_id);

create policy "project_envs insert own"
  on public.project_envs for insert
  with check (auth.uid() = user_id);

create policy "project_envs update own"
  on public.project_envs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "project_envs delete own"
  on public.project_envs for delete
  using (auth.uid() = user_id);
