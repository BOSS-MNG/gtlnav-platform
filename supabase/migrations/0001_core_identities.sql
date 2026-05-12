-- GTLNAV — Phase 6A migration 0001
-- Core identity tables: profiles + billing_profiles.
--
-- profiles is the per-user mirror of auth.users that the dashboard reads.
-- billing_profiles holds the current plan choice; real Stripe linkage comes
-- in a later phase.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  company text,
  role text not null default 'client'
    check (role in ('client', 'support_agent', 'operator', 'admin', 'super_admin')),
  locale text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

drop policy if exists "profiles read own"    on public.profiles;
drop policy if exists "profiles update own"  on public.profiles;
drop policy if exists "profiles insert own"  on public.profiles;

create policy "profiles read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-provision a profile row on user signup so the dashboard has something
-- to read before the client renders the welcome screen.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Billing profile (plan + simulated state until Stripe is wired).
create table if not exists public.billing_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'inactive',
  customer_id text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_profiles enable row level security;

drop policy if exists "billing_profiles read own"   on public.billing_profiles;
drop policy if exists "billing_profiles insert own" on public.billing_profiles;
drop policy if exists "billing_profiles update own" on public.billing_profiles;

create policy "billing_profiles read own"
  on public.billing_profiles for select
  using (auth.uid() = user_id);

create policy "billing_profiles insert own"
  on public.billing_profiles for insert
  with check (auth.uid() = user_id);

create policy "billing_profiles update own"
  on public.billing_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
