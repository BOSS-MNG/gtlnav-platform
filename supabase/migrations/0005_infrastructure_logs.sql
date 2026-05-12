-- GTLNAV — Phase 6A migration 0005
-- Audit ledger. Written by ~20 server paths today; this migration nails
-- down the schema so schema-tolerant fallbacks become unnecessary.

create table if not exists public.infrastructure_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  /** High-level event name (e.g. "deployment_started", "dns_check_success"). */
  event_type text not null,
  /** Free-form short summary shown in log streams. */
  message text not null,
  /** Coarse severity used by both API key and worker paths. */
  severity text not null default 'info'
    check (severity in ('debug', 'info', 'notice', 'warning', 'warn', 'error', 'success', 'critical')),
  /** Some routes also write a `level` column for back-compat with the
   *  in-process simulator log shapes — kept as a duplicate of severity. */
  level text,
  /** Source subsystem (e.g. "deployment_api", "worker_runner", "dns_monitor"). */
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists infrastructure_logs_user_idx
  on public.infrastructure_logs (user_id, created_at desc);
create index if not exists infrastructure_logs_project_idx
  on public.infrastructure_logs (project_id, created_at desc);
create index if not exists infrastructure_logs_event_idx
  on public.infrastructure_logs (event_type);
create index if not exists infrastructure_logs_severity_idx
  on public.infrastructure_logs (severity);
create index if not exists infrastructure_logs_runtime_app_idx
  on public.infrastructure_logs ((metadata->>'runtime_app_id'))
  where metadata ? 'runtime_app_id';

alter table public.infrastructure_logs enable row level security;

drop policy if exists "infrastructure_logs read own"   on public.infrastructure_logs;
drop policy if exists "infrastructure_logs insert own" on public.infrastructure_logs;

create policy "infrastructure_logs read own"
  on public.infrastructure_logs for select
  using (auth.uid() = user_id);

-- Owners can write their own log lines (admin dashboards, client-side audit).
create policy "infrastructure_logs insert own"
  on public.infrastructure_logs for insert
  with check (auth.uid() = user_id);

-- Workers (service role) bypass RLS and may insert for any user_id.
