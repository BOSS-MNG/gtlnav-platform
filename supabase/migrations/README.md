# GTLNAV Supabase migrations

Apply these migrations to your Supabase project in order. They establish the
minimum schema required for Phase 6A (real deployment engine) to operate.

## Order

| # | File | Purpose |
|---|------|---------|
| 0001 | `0001_core_identities.sql` | `profiles` + `billing_profiles` + auto-provision trigger |
| 0002 | `0002_projects.sql` | `projects` + `project_envs` |
| 0003 | `0003_deployments_and_queue.sql` | `deployments` + `deployment_jobs` + `deployment_artifacts` |
| 0004 | `0004_domains.sql` | `domains` (with real `ssl_status` state machine) |
| 0005 | `0005_infrastructure_logs.sql` | Audit ledger |
| 0006 | `0006_runtime_instances.sql` | Static / docker runtime tracking |
| 0007 | `0007_docker_runtime.sql` | Docker columns on `runtime_instances` + `proxy_routes` table + `projects.runtime_kind` |
| 0008 | `0008_runtime_instance_framework.sql` | Adds `runtime_instances.framework` column (Phase 6C schema alignment) |
| 0009 | `0009_phase5_hosting_foundation.sql` | Phase 5 hosting aliases/fields + `deployment_logs` foundation |

## How to apply

### Option A — Supabase CLI

```bash
supabase db push --db-url "$SUPABASE_DB_URL"
```

If you don't track the migration metadata table yet, you can apply each file
directly:

```bash
for f in supabase/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

### Option B — Supabase Studio SQL editor

Paste each file in order. All files are idempotent — `create table if not
exists`, `drop policy if exists` — so re-running them is safe.

## What is intentionally **not** here

These tables are still in `setup_sql` strings inside the lib/component files
and will move to migrations as their owning features become real:

- `api_keys` (today: `src/components/account-settings/account-settings-client.tsx`)
- `deploy_hooks` (today: `src/components/webhooks/webhooks-client.tsx`)
- `github_accounts`, `github_repositories` (today: `src/components/integrations/github-integration-client.tsx`)
- `runtime_apps` (legacy synthetic-fallback table; superseded by `runtime_instances` from migration 0006)
- `edge_functions`, `function_deployments`, `function_logs` (functions UI is still preview-only)
- `notifications`, `notification_preferences` (notifications UI is still preview-only)
- `payment_methods`, `subscriptions`, `invoices`, `billing_events` (billing is out of scope for Phase 6A)
- `workspaces`, `workspace_members`, `workspace_invitations`, `project_workspaces` (team module is preview-only)
- `security_events`, `login_sessions`, `trusted_devices`, `workspace_security` (security module is preview-only)
- `git_integrations` (preview-only)

When you graduate a preview module to live, move its DDL out of the component
into a new numbered migration file.
