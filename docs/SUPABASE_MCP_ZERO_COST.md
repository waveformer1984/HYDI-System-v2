# Supabase MCP — zero-cost, local-first use

How HYDI uses the [Supabase MCP server](https://supabase.com/docs/guides/getting-started/mcp) without paid MCP fees, branching charges, or accidental production mutation.

Configuration lives in [`.mcp.json`](../.mcp.json):

| Server | URL role |
|--------|----------|
| **`supabase-local`** (default) | `http://127.0.0.1:54321/mcp` after `supabase start` — docs, advisors, schema inspection on **local** Postgres |
| **`supabase-cloud-readonly`** (optional) | Hosted project, **`read_only=true`**, no `branching` / `storage` / `account` feature groups — inspect-only if cloud project still exists |

**Never enable** hosted MCP `branching` tools (paid plan; `create_branch` triggers cost confirmation). **Never** call `create_project` / `create_branch` from an agent.

Schema changes ship as **git migrations** in `supabase/migrations/` plus migration tests — not as MCP `apply_migration` on hosted production.

---

## Frank (heidi-pc) vs cloud agent VMs

These are different databases with different rules.

### Frank — local Supabase **is** the live data plane

On Frank, Docker Supabase (`supabase start` / PM2 stack) holds **production-like** data. Treat MCP as **read-mostly**:

- Prefer **`search_docs`**, **`get_advisors`**, **`list_tables`**, **`list_migrations`** without SQL.
- **`execute_sql`**: require **manual human approval before every call**. Use only for single, intentional read queries (SELECT / EXPLAIN). **Never** use MCP for destructive iteration (DROP, TRUNCATE, mass UPDATE/DELETE, “try and see” DDL).
- **`apply_migration` via MCP**: do **not** use on Frank’s live DB; add `.sql` files in the repo and apply through your normal migration path.
- Optional extra guard: point a Frank-only MCP entry at `http://127.0.0.1:54321/mcp?read_only=true&features=...` if your client supports a second server name (same tools, Postgres read-only role per Supabase docs).

### Cloud agent VM — local Supabase is **disposable CI parity**

After [`.cursor/cloud-agent-start.sh`](../.cursor/cloud-agent-start.sh) / `npx supabase start` (same exclusions as CI), the VM’s `127.0.0.1:54321` database is **throwaway**. Agents may use MCP for advisors and schema inspection to support migration PRs.

- SQL iteration on the VM should still end in **committed migrations**, not only MCP-applied state.
- Do **not** point cloud agents at Frank’s tailnet DB for MCP writes (see [CURSOR_CLOUD_AGENT.md](./CURSOR_CLOUD_AGENT.md)).

---

## Allowed tools (both environments)

- **`search_docs`** — no Supabase project cost.
- **`get_advisors`** — security/performance on whichever DB the server is bound to.
- **`list_tables`**, **`list_extensions`**, **`list_migrations`** — orientation.
- **`generate_typescript_types`** — only when you will actually commit/use the output.

## Disallowed or approval-gated

| Tool / action | Rule |
|---------------|------|
| `create_project`, `create_branch` | **Forbidden** — billable |
| Hosted MCP without `read_only=true` | **Forbidden** unless Jordan explicitly approves a one-off |
| `deploy_edge_function`, storage writes | **Forbidden** from autonomous agents |
| `execute_sql` on **Frank** | **Manual approval every time**; no destructive iteration |
| `apply_migration` on **hosted** | Use repo migrations instead |

Paid LLM usage is still gated by `HYDI_ALLOW_PAID_LLM` / [paid-llm-gate](../lib/cost/paid-llm-gate.js); MCP does not bypass that.

---

## `read_only=true` on local MCP — verification (evidence, not promises)

Supabase documents that `read_only=true` runs SQL as a read-only Postgres user and that hosted/local URLs accept query parameters such as `read_only=true` ([MCP configuration options](https://supabase.com/docs/guides/getting-started/mcp#configuration-options)). **This repo records what we actually ran**, not assumed behaviour.

### Cloud agent VM — 2026-11-14 (this PR branch)

| Check | Result |
|-------|--------|
| `npx supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor` (CI parity) | **Failed** — `DbSetupError` during init; log showed `Realtime.Repo` connection pool timeout (`~15s`) while a container ran `/app/bin/migrate`, then CLI pruned containers/volumes |
| `npx supabase start … -x realtime` (retry) | **Same failure** — Realtime migrator still appeared in debug logs |
| TCP `127.0.0.1:54321` | **Nothing listening** after failed start |
| `curl --connect-timeout 2 http://127.0.0.1:54321/mcp` | **Connection refused** (exit 7) |
| `curl --connect-timeout 2 http://127.0.0.1:54321/mcp?read_only=true` | **Connection refused** (exit 7) — could not test URL acceptance or tools on local MCP |
| Cursor **Supabase MCP OAuth** (hosted) | **Declined** on this run — no authenticated `apply_migration` / `execute_sql` probe |
| `curl https://mcp.supabase.com/mcp?read_only=true&project_ref=…` (unauthenticated GET) | **HTTP 401** — endpoint reachable; does **not** prove `read_only` blocks `apply_migration` |

**Conclusion for this run:** **`read_only=true` on `http://127.0.0.1:54321/mcp` and whether it blocks `apply_migration` were not verified here** because local Supabase did not stay up and hosted MCP was not authenticated.

### Re-verify on a host where `supabase start` succeeds (e.g. Frank or green CI)

Run after `npx supabase status` shows API URL on `:54321`:

```bash
# 1) Transport reachability (does not prove read_only semantics)
curl -sS -o /dev/null -w "plain:%{http_code}\n" --connect-timeout 3 \
  "http://127.0.0.1:54321/mcp"
curl -sS -o /dev/null -w "read_only:%{http_code}\n" --connect-timeout 3 \
  "http://127.0.0.1:54321/mcp?read_only=true"
```

Configure the agent client with **`supabase-local`** using `?read_only=true` on the URL, authenticate if prompted (local Studio/CLI session), then:

1. Call **`apply_migration`** with a harmless name and `SELECT 1` SQL — record **success vs refused / read-only error**.
2. Repeat with the same URL **without** `read_only=true` on a **throwaway** VM only (never on Frank’s live DB).

Append results to this section (date, host, CLI version, outcome table).

---

## Cloud agent testing vs Frank (pre-push / Tier 1)

The git **pre-push** hook runs `npm test`, which is **Tier 1 hermetic** only (`tests/TEST_TIERS.json`). Suites that need live Postgres/Supabase on `:54322` / `:54321` are in **Tier 2** (`npm run test:local`) and are **not** run on push. A green pre-push on a cloud VM does **not** prove local Supabase was up — it often is not (`DbSetupError` on small VMs).

| Gate | Command | Live Supabase? |
|------|---------|----------------|
| Pre-push / default `npm test` | Tier 1 (~606 suites) | No (socket guard blocks service ports) |
| Full DB confidence | `npm run test:local` or CI with `supabase start` | Yes |
| Frank production DB | Manual approval for MCP `execute_sql` only | N/A — see [Frank vs cloud agent VMs](#frank-heidi-pc-vs-cloud-agent-vms) |

**Handoff (2026-11-14):** `#581` merged (this doc + `.mcp.json`). Reboot/recovery on Frank stays **on hold** until an independently verified path exists; see [MOBILE_OPERATIONS.md](./MOBILE_OPERATIONS.md).

---

## Quick reference

- Cloud agents: load env then tests — [CURSOR_CLOUD_AGENT.md](./CURSOR_CLOUD_AGENT.md).
- Cursor registers **ProtoForge** in [`.cursor/mcp.json`](../.cursor/mcp.json); Supabase stays in [`.mcp.json`](../.mcp.json) (Claude Code / shared). Do not put secrets in `.cursor/mcp.json`.
- Local-first posture: [LOCAL_FIRST_PHASE1_RUNBOOK.md](../LOCAL_FIRST_PHASE1_RUNBOOK.md).