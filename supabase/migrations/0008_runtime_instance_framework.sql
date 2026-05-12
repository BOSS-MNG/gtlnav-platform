-- GTLNAV — Phase 6C migration 0008
--
-- Adds the missing `framework` column to `runtime_instances` so the deployment
-- worker can persist which framework it detected (next-ssr, express, vite,
-- next-static, dockerfile, …) alongside the existing `runtime_kind` column
-- ('static' | 'docker').
--
-- This unblocks the Phase 6B Docker/SSR pipeline: the worker writes
-- `runtime_kind` (which already exists from 0006) and `framework` (added
-- here), and the control plane endpoint `/api/worker/runtime-instance`
-- persists both. Before this migration, the worker was attempting to write
-- `framework` (and the now-removed `hosting_kind`) to columns that did not
-- exist, silently dropping every runtime row.
--
-- The migration is idempotent. Re-running it on a database that already has
-- the column or index is a no-op.

alter table public.runtime_instances
  add column if not exists framework text;

-- Intentionally no CHECK constraint on `framework`: detection grows over
-- time and we don't want every new framework name to require another
-- migration. The list is owned by `workers/deployment-worker/src/framework.js`.

-- Index for filtering "show me everything this user is running on Next SSR".
create index if not exists runtime_instances_framework_idx
  on public.runtime_instances (framework);
