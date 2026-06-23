---
name: testing-heidi-chat
description: Test the Heidi chat pipeline (/api/chat, orchestrator, memory, action execution) end-to-end on a fully-local $0 stack. Use when verifying chat, streaming, memory, or action-execution changes without paid API credits.
---

# Testing Heidi chat end-to-end (local $0 stack)

Heidi's chat has two code paths in `pages/api/chat.ts`:
- **Anthropic agent path** (`lib/heidi-agent.ts`) — native tool-calling + token streaming. Requires `ANTHROPIC_API_KEY` with credits. Cannot be tested $0.
- **Fallback orchestrator path** (`lib/orchestrator.ts`) — used when `ANTHROPIC_API_KEY` is unset. Non-streaming (writes the full response over the same SSE contract). Testable fully locally.

UI path: homepage `pages/index.tsx` → `components/Chat.tsx` → `hooks/useHeidi.ts` POSTs `/api/chat` and parses SSE events (`metadata` / `content` / `actions` / `[DONE]`). The homepage also polls `/api/status`; `useHeidi` calls `/api/status` + `/api/session`.

## Local $0 stack setup

### 1. Local Supabase (Docker)
- Supabase CLI is a two-binary shim — `supabase` and `supabase-go` must live together. Install the full tarball to `$HOME/.local/share/supabase` and add to PATH (don't just drop the single `supabase` binary in `/usr/local/bin`).
- `supabase start` brings up Postgres at `http://127.0.0.1:54321`. Get keys with `supabase status -o env` (ANON_KEY, SERVICE_ROLE_KEY).
- Apply schema: `docker exec -i <supabase_db_container> psql -U postgres -d postgres < supabase/heidi-init.sql` (creates `memories`, `actions`, `sessions`).
- **CRITICAL GOTCHA:** tables created via raw `psql` as `postgres` have **no grants** for the `service_role`/`anon` roles, so PostgREST inserts fail with `42501 permission denied` and rows silently never persist (the app swallows the error). Fix:
  ```sql
  GRANT ALL ON public.memories, public.actions, public.sessions TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ```
  Verify with a direct REST insert using the service-role key before blaming app code.
- **Schema note:** the `actions` table columns are `id, session_id, task_name, status, payload, created_at` — there is **no** `type`/`action_type` column. Query inserted actions with `select task_name, status, created_at from actions`. The action *kind* (e.g. `create_task`) is stored in `task_name`.

### 2. Local model (Ollama)
- Install needs `zstd` first (`sudo apt-get install -y zstd`) or the installer errors.
- Pull a model that follows JSON instructions: **`llama3.2:3b` is reliable; `llama3.2:1b` is too weak** and frequently emits invalid JSON → the orchestrator's `ActionParser` retries then returns a "safe fallback" message (looks like a failure).
- Keep the model **resident** so calls are fast and consistent: `curl localhost:11434/api/generate -d '{"model":"llama3.2:3b","prompt":"hi","stream":false,"keep_alive":-1}'`. Without this, cold reloads between requests blow the latency budget.
- On CPU a `3b` response typically takes ~6–10s. The default local budget is 5s, so you **must** raise `LOCAL_MODEL_TIMEOUT_MS` (see below) or every local response is discarded and routed to the (creditless) API fallback.

### 3. Dev server env (force fallback path)
Start `next dev` with:
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` **UNSET** (forces the local + fallback path)
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_URL` = `http://127.0.0.1:54321`
- `SUPABASE_SERVICE_ROLE_KEY` = local service-role key, `NEXT_PUBLIC_SUPABASE_ANON_KEY` = local anon key
- `ENABLE_LOCAL_MODEL=true`, `LOCAL_MODEL_URL=http://localhost:11434`, `LOCAL_MODEL_NAME=llama3.2:3b`
- **`LOCAL_MODEL_TIMEOUT_MS=30000`** — governs BOTH the abort timeout and the success-routing latency gate in `lib/ModelManager.ts` (`getLocalTimeoutMs()`). Default is 5000; raise it on slow CPU.

## Verifying the fixes (as of PR #116, no temp edits needed)
The 3 bugs that previously required throwaway patches are **fixed**. Expected healthy behavior:
1. **Homepage renders on its own** — `pages/index.tsx` no longer instantiates `HeidiOrchestrator` client-side; it `fetch('/api/status')`. No `supabaseKey is required` crash.
2. **`/api/status` + `/api/session` are real endpoints** — `GET /api/status` returns `{model_status, memory_connected, allowed_actions:[5 items]}`; `GET /api/session?session_id=x` returns the session row or `null` (200); missing `session_id` → 400. The StatusPanel shows `Memory Connected: Yes`, `Allowed Actions: 5`.
3. **Local responses >5s are accepted** — with `LOCAL_MODEL_TIMEOUT_MS` raised, a ~6–10s local response returns `model_used: "local"` (not `api`) and persists. Confirm in the dev log (`POST /api/chat 200 in <N>ms`, N>5000) and in the `actions`/`memories` tables.

Quick end-to-end check: send `Create a task to email the quarterly report to finance` in the chat → expect `Model: local`, an assistant reply, a `create_task` action chip, and a new `actions` row with `task_name='create_task'`.

## Truthfulness check (P0 real-action-execution)
If the model picks `send_email`, it should log as `failed` ("Email not configured") rather than a fake success — this confirms real action execution (no `Math.random()` fake-success).

## What still can't be tested $0
- **Anthropic native tool-calling + token streaming** (`lib/heidi-agent.ts`) — needs `ANTHROPIC_API_KEY` **with credits**. A creditless key returns `400: "Your credit balance is too low"`. Verify credit with a minimal `curl https://api.anthropic.com/v1/messages` before planning to test this path.
- **OpenAI embedding semantic recall** — needs `OPENAI_API_KEY` quota; degrades gracefully to null embeddings otherwise.

## Devin Secrets Needed
- `ANTHROPIC_API_KEY` — only for the Anthropic native streaming/tool path (must have credit).
- `OPENAI_API_KEY` — only for real embedding-based memory recall (must have quota).
- None required for the local $0 fallback path (local Supabase + Ollama supply their own keys).
