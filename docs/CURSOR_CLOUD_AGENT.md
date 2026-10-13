# Cursor Cloud Agents (phone → PR → heidi-pc read-only)

Cloud agents run in an isolated VM with a checkout of this repo. Your phone
is the control surface; the agent pushes branches and opens PRs. GitHub
Actions runs on those PRs (`unit-tests.yml`, `integration-tests.yml`).

## Repository environment

| File | Role |
|------|------|
| `.cursor/environment.json` | Cursor build + boot: `install` + `start` |
| `.cursor/cloud-agent-install.sh` | `npm ci`, protoforge-mcp deps, Docker package |
| `.cursor/cloud-agent-start.sh` | Docker, `supabase start` (CI parity), optional tailnet |
| `.cursor/cloud-agent-env.sh` | Source Supabase URL/keys after boot |

After the agent boots, load DB env before tests:

```bash
set -a && source .cursor/cloud-agent-env.sh && set +a
npm test
npm run typecheck
```

Generated file (never commit): `.cursor/supabase-local.env` (mode 600).

Boot logs: `/tmp/cursor/start-user/start-user.log` (and `start-user.status` when
the start script exits). If Supabase fails, the start script exits non-zero after
three attempts; the Supabase CLI sometimes prints JSON errors while still exiting
0, so health is verified with `supabase status` and a REST readiness probe.

## Local Supabase (same as CI)

`cloud-agent-start.sh` runs:

```bash
npx supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor
```

That applies repo migrations and `supabase/seed.sql`, matching
`.github/workflows/unit-tests.yml`. Without it, ~25 DB-backed unit suites and
the pre-push hook’s full Jest run will fail.

## Live HYDI on heidi-pc (read-only MCP)

Cloud agents **do not** reach heidi-web or Supabase on your PC unless you
join the tailnet. See [TAILSCALE.md](./TAILSCALE.md).

1. **Secrets** (Cursor cloud agent environment — never commit):
   - `TS_AUTHKEY` — ephemeral, reusable, tag `tag:agent`, short expiry.
   - `PROTOFORGE_MCP_TOKEN` — same token heidi-pc serves on `:8470` (see
     `scripts/tailscale/serve-mcp.ps1`).

2. **Boot:** `cloud-agent-start.sh` runs `scripts/tailscale/agent-join.sh`
   when `TS_AUTHKEY` is set. Tailnet policy should allow `tag:agent` →
   `tag:hydi-host` **tcp:8470** only.

3. **MCP:** `.cursor/mcp.json` registers the local stdio `protoforge` server
   for Frank’s machine. On a cloud agent, point Cursor MCP at the HTTP
   endpoint instead, e.g. `https://heidi-pc.<tailnet>.ts.net:8470/mcp` with
   `Authorization: Bearer $PROTOFORGE_MCP_TOKEN`. Tools are read-only v0.1:
   `system_health`, `mobile_status`, `pending_approvals`, `recent_actions`,
   `heidi_events`, `decision_bounds`, `stripe_balance`, `boot_plan`.

## What agents should not do from the cloud

- Approve actions, restart services, or mutate production (MCP is read-only).
- Bypass `scripts/preflight.js` canonical identity checks on heidi-pc.
- Commit `.env`, `.env.local`, or `.cursor/supabase-local.env`.

## Next.js dev on the VM

Next.js 16 defaults to Turbopack; this repo’s `next.config.js` uses webpack
hooks. Use `npm run dev` (includes `--webpack`).

## Saving the environment in Cursor

Link this repo’s `.cursor/environment.json` in the Cursor dashboard (Cloud
Agents → Environments), trigger a **build**, and activate the build when green.
Until then, agents boot the default image without `install`/`start`.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `Bind for 0.0.0.0:54322 failed` | Another Postgres/Supabase on the VM | `npx supabase stop`; remove stray containers on 54321/54322 |
| `DbSetupError` / Realtime pool timeout | Slow first boot on a small VM | Re-run boot; `cloud-agent-start.sh` retries up to 3 times |
| Tests `ECONNREFUSED` on 54321 | Start script still running or failed | Wait for start log; `source .cursor/cloud-agent-env.sh` |
| MCP tools unavailable | `TS_AUTHKEY` unset | Optional; set secrets per [TAILSCALE.md](./TAILSCALE.md) |
