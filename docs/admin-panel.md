# Admin Panel

## Overview

The admin panel at `/admin/projects` lets admin users manage the project catalogue — creating, editing, and deleting `ProjectDefinition` records without touching the database directly.

## Assigning the First Admin

There is no UI for role promotion (by design — it's a rare, deliberate action). Set your first admin via SQL:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

Run this against the Postgres container in Dokploy → **Terminal** tab:

```bash
psql -U moulinator moulinator
```

After re-logging in, the **admin** link appears in the sidebar navigation.

## What Admins Can Do

| Action | Endpoint | Effect |
|--------|----------|--------|
| List projects | `GET /projects` | Public, same as students |
| Create project | `POST /admin/projects` | Adds row to `project_definitions` |
| Edit project | `PUT /admin/projects/:slug` | Updates any field except slug |
| Delete project | `DELETE /admin/projects/:slug` | Hard-deletes the row |

All write operations are audit-logged (`projects.create`, `projects.update`, `projects.delete`).

## Access Control

- Endpoints guarded by `RolesGuard` + `@Roles('admin')`.
- Students (role=`student`) get **403 Forbidden** if they call write endpoints directly.
- The admin nav link is hidden from non-admin users client-side (role comes from JWT).

## Project Fields

| Field | Required | Notes |
|-------|----------|-------|
| `slug` | yes (create only) | Unique, lowercase, immutable after creation |
| `name` | yes | Human-readable label |
| `language` | yes | `c`, `cpp`, `python`, `bash`, `haskell` |
| `tests_path` | yes | Path inside the tests-repo, e.g. `cpool-day06/tests` |
| `runner_image_repo` | yes | OCI repo without tag, e.g. `ghcr.io/org/moulinator/runner-c` |
| `runner_image_digest` | yes | Pinned digest `sha256:…` — never use floating tags |
| `hermetic` | no | Default `true` — zero egress for job containers |
| `timeout_seconds` | no | Default `600` |
| `harness_entrypoint` | yes | Relative path to the test harness script |
| `resource_limits` | no | JSON: `{"memory_mb":2048,"cpus":2,"pids":512,"disk_mb":1024}` |
