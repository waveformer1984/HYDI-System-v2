# Phase 1 Runbook: Promote Local Supabase to Production

Companion to `LOCAL_FIRST_EXECUTION_PLAN.md`'s Phase 1. This is written to
be run by an operator (or a coding session) that actually has network
access to `heidi-pc` and the live Supabase Cloud project — **neither of
which any Claude Code Remote sandbox session has**. That was confirmed
directly while preparing this runbook (2026-07-16): DNS doesn't resolve
`heidi-pc.tailc50af2.ts.net` from the sandbox, generic outbound HTTPS
(even via the environment's dedicated web-fetch tool) returns `403` for
every host tried except the git remote, and the `supabase` CLI isn't
installed. If you're a future session picking this up, don't re-attempt
that access — go straight to "what a sandbox session *can* still do" at
the bottom.

## Prerequisites (do these first, manually)

1. Docker + Docker Compose installed on `heidi-pc` (or whichever host is
   the long-lived target — the rest of this runbook says "the host").
2. A Supabase Cloud service-role key with read access to project
   `akbnfovjdcobifeupvbn`, injected directly per `SECURITY_PROTOCOL.md`
   (never pasted into a session, a file, or a chat).
3. Confirm free disk space on the host exceeds 3x the current database
   size (`pg_dump` writes a full copy; you'll want headroom for the dump,
   the restored copy, and Docker's own volumes).
4. Pick and note down (you'll need it in step 3): the local Postgres port
   you want to expose (Supabase's default is `54322` for direct Postgres,
   `54321` for the API gateway — matches `STARTUP_GUIDE.md`'s existing
   local-dev port map, so reusing those avoids a second set of ports to
   remember).

## Step 1 — stand up the self-hosted stack

Don't hand-copy a `docker-compose.yml` into this repo from memory — clone
Supabase's own reference compose file on the host, where you have real
internet access:

```bash
git clone --depth 1 https://github.com/supabase/supabase.git /opt/supabase-selfhost
cd /opt/supabase-selfhost/docker
cp .env.example .env
```

Edit `.env` (on the host, never through a session) and set at minimum:
`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
`DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`. Generate fresh values — do
not reuse the cloud project's secrets, since this is a new identity for
the same data, not an extension of the old one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Bring it up:

```bash
docker compose up -d
docker compose ps   # confirm every service is "healthy" or "running" before continuing
```

This should feel identical to `supabase start` in local dev
(`STARTUP_GUIDE.md`) — because it's the same stack, just run persistently
with `docker compose` instead of the CLI's ephemeral dev mode.

## Step 2 — migrate the schema

Run every migration in `supabase/migrations/` against the new local
instance, in order, exactly as the governance gate (`hdi-governance-gate.yml`)
already validates them against a fresh Postgres in CI — that's a live
proof this works against a clean database, not just the cloud project's
already-migrated one:

```bash
for f in $(ls supabase/migrations/*.sql | sort); do
  psql "$LOCAL_DATABASE_URL" -f "$f" || { echo "FAILED at $f — stop and investigate before continuing"; exit 1; }
done
```

(`.sql.skip` files are intentionally excluded — the glob above already
skips them since it only matches `*.sql`.)

## Step 3 — migrate the data

Use `scripts/migrate-to-local-supabase.sh` (added alongside this runbook).
It wraps `pg_dump --data-only` from the cloud project into the freshly
schema-migrated local instance, with a dry-run mode and a row-count
verification pass so you're not trusting a silent success:

```bash
export SOURCE_DATABASE_URL="postgresql://postgres:<service-role-password>@db.akbnfovjdcobifeupvbn.supabase.co:5432/postgres"
export TARGET_DATABASE_URL="postgresql://postgres:<local-password>@localhost:54322/postgres"

./scripts/migrate-to-local-supabase.sh --dry-run   # prints the pg_dump/pg_restore commands without running them
./scripts/migrate-to-local-supabase.sh             # actually runs it, then verifies row counts match per table
```

Never pass these connection strings through a chat session — export them
directly in the host's own shell.

## Step 4 — cut over

Once row counts verify clean, update the *values* (not committed to this
repo — these are env vars/secrets):

- `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` → the local instance's URL,
  reachable over Tailscale (e.g. `http://heidi-pc.tailc50af2.ts.net:54321`),
  not exposed to the public internet.
- Everywhere these are set today: `.env.local`, whatever `pm2`/`ecosystem.config.js`
  env block the live processes actually read from (see `DEPLOYMENT.md`'s
  process map for the current source of truth on that).

Then update, as normal reviewable commits in this repo (these parts *can*
be done by a coding session, since they're just config/docs, not live
infra):
- `.mcp.json` — point the Supabase MCP server's `project_ref` /connection
  at the local instance once it's live.
- `health-monitor.yml` — its health check currently pings the cloud
  project; repoint at the local instance's health endpoint.

## Step 5 — burn-in and decommission

Run both instances in parallel for a period you're comfortable with
(a week is a reasonable starting point — adjust to your own risk
tolerance, this runbook isn't picking that number for you). Once
confident:

1. Take a final `pg_dump` of the cloud project as a cold backup (keep it
   somewhere durable, off both the cloud project and `heidi-pc` alone).
2. Pause (don't immediately delete) the cloud project from the Supabase
   dashboard.
3. After a further waiting period with no issues, delete it.

## What a sandbox session *can* still do without host access

If you're continuing this from a Claude Code Remote session with the
same access constraints documented at the top: you can still review/edit
this runbook and the migration script, update `.mcp.json` /
`health-monitor.yml` once given the actual local endpoint value, and
review whatever the operator reports back from running steps 1-3 by hand
— but you cannot execute steps 1-3 yourself. Say so plainly rather than
assuming a later session might have access this one didn't.
