-- GTLNAV — Phase 6A migration 0003
-- deployments + deployment_jobs (worker queue) + deployment_artifacts.

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'queued',
  branch text,
  commit_sha text,
  deployment_url text,
  build_logs text,
  started_at timestamptz,
  finished_at timestamptz,
  parent_deployment_id uuid references public.deployments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deployments_project_idx on public.deployments (project_id);
create index if not exists deployments_user_idx on public.deployments (user_id);
create index if not exists deployments_status_idx on public.deployments (status);
create index if not exists deployments_created_idx on public.deployments (created_at desc);

alter table public.deployments enable row level security;

drop policy if exists "deployments read own"   on public.deployments;
drop policy if exists "deployments insert own" on public.deployments;
drop policy if exists "deployments update own" on public.deployments;
drop policy if exists "deployments delete own" on public.deployments;

create policy "deployments read own"
  on public.deployments for select
  using (auth.uid() = user_id);

create policy "deployments insert own"
  on public.deployments for insert
  with check (auth.uid() = user_id);

create policy "deployments update own"
  on public.deployments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "deployments delete own"
  on public.deployments for delete
  using (auth.uid() = user_id);

-- Worker queue: control plane inserts pending rows, workers CAS-claim them
-- and push status + logs through /api/worker/* endpoints.
create table if not exists public.deployment_jobs (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','claimed','running','succeeded','failed','canceled')),
  attempt int not null default 1,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deployment_jobs_status_created_idx
  on public.deployment_jobs (status, created_at);
create index if not exists deployment_jobs_deployment_id_idx
  on public.deployment_jobs (deployment_id);
create index if not exists deployment_jobs_user_id_idx
  on public.deployment_jobs (user_id);

alter table public.deployment_jobs enable row level security;

drop policy if exists "deployment_jobs read own"   on public.deployment_jobs;
drop policy if exists "deployment_jobs insert own" on public.deployment_jobs;
drop policy if exists "deployment_jobs update own" on public.deployment_jobs;

create policy "deployment_jobs read own"
  on public.deployment_jobs for select
  using (auth.uid() = user_id);

create policy "deployment_jobs insert own"
  on public.deployment_jobs for insert
  with check (auth.uid() = user_id);

create policy "deployment_jobs update own"
  on public.deployment_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- NOTE: workers must run with the service role and bypass these policies.
-- The control plane never uses the service role for tenant-driven mutations.

-- Final build outputs the worker produced. Multiple artifacts allowed per
-- deployment (e.g. static bundle + manifest + sourcemaps).
create table if not exists public.deployment_artifacts (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null default 'static'
    check (kind in ('static', 'docker', 'archive', 'other')),
  /** Path on the worker / web node where the artifact lives (e.g.
   *  $DEPLOYMENTS_ROOT/<project_slug>/<deployment_id>). */
  artifact_path text,
  /** Bytes occupied on disk (best-effort). */
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deployment_artifacts_deployment_idx
  on public.deployment_artifacts (deployment_id);
create index if not exists deployment_artifacts_project_idx
  on public.deployment_artifacts (project_id);

alter table public.deployment_artifacts enable row level security;

drop policy if exists "deployment_artifacts read own"   on public.deployment_artifacts;
drop policy if exists "deployment_artifacts insert own" on public.deployment_artifacts;

create policy "deployment_artifacts read own"
  on public.deployment_artifacts for select
  using (auth.uid() = user_id);

create policy "deployment_artifacts insert own"
  on public.deployment_artifacts for insert
  with check (auth.uid() = user_id);
