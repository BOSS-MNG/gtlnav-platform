-- GTLNAV — Phase 6A migration 0004
-- Custom domains. SSL is real-status only (pending / pending_dns / pending_ssl
-- / issued / failed). No fake 'issued' from the dashboard anymore.

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  domain text not null,
  status text not null default 'pending_dns'
    check (status in (
      'pending_dns', 'verified', 'failed', 'archived'
    )),
  ssl_status text not null default 'pending_dns'
    check (ssl_status in (
      'pending_dns', 'pending_ssl', 'issued', 'ssl_failed', 'disabled'
    )),
  dns_provider text,
  /** CNAME (subdomain) or A (apex) target the user should configure. */
  dns_target text,
  verified_at timestamptz,
  ssl_requested_at timestamptz,
  ssl_issued_at timestamptz,
  ssl_failed_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists domains_user_domain_uidx
  on public.domains (user_id, lower(domain));
create index if not exists domains_project_idx on public.domains (project_id);
create index if not exists domains_status_idx on public.domains (status);

alter table public.domains enable row level security;

drop policy if exists "domains read own"   on public.domains;
drop policy if exists "domains insert own" on public.domains;
drop policy if exists "domains update own" on public.domains;
drop policy if exists "domains delete own" on public.domains;

create policy "domains read own"
  on public.domains for select
  using (auth.uid() = user_id);

create policy "domains insert own"
  on public.domains for insert
  with check (auth.uid() = user_id);

create policy "domains update own"
  on public.domains for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "domains delete own"
  on public.domains for delete
  using (auth.uid() = user_id);
