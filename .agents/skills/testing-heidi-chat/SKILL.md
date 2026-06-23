---
name: testing-heidi-chat
description: Test the Heidi chat pipeline (/api/chat, orchestrator, memory, action execution) end-to-end on a fully-local $0 stack. Use when verifying chat, streaming, memory, or action-execution changes without paid API credits.
---

# Testing Heidi chat end-to-end (local $0 stack)

Heidi's chat has two code paths in `pages/api/chat.ts`:
- **Anthropic agent path** (`lib/heidi-agent.ts`) — native tool-calling + token streaming. Requires `ANTHROPIC_API_KEY` with credits. Cannot be tested $0.
- **Fallback orchestrator path** (`lib/orchestrator.ts`) — used when `ANTHROPIC_API_KEY` is unset. Non-streaming (writes the full response over the same SSE contract). Testable fully locally.

UI path: homepage `pages/index.tsx` → `components/Chat.tsx` → `hooks/useHeidi.ts` POSTs `/api/chat` and parses SSE events (`metadata` / `content` / `actions` / `[DONE]`).

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

### 2. Local model (Ollama)
- Install needs `zstd` first (`sudo apt-get install -y zstd`) or the installer errors.
- Pull a model that follows JSON instructions: **`llama3.2:3b` is reliable; `llama3.2:1b` is too weak** and frequently emits invalid JSON → the orchestrator's `ActionParser` retries then returns a "safe fallback" message (looks like a failure).
- Keep the model **resident** so calls are fast and consistent: `curl localhost:11434/api/generate -d '{"model":"llama3.2:3b","prompt":"hi","stream":false,"keep_alive":-1}'`. Without this, cold reloads between requests blow the latency budget.

### 3. Dev server env (force fallback path)
Start `next dev` with: `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` UNSET, `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_URL` = `http://127.0.0.1:54321`, `SUPABASE_SERVICE_ROLE_KEY` = local key, `ENABLE_LOCAL_MODEL=true`, `LOCAL_MODEL_URL=http://localhost:11434`, `LOCAL_MODEL_NAME=llama3.2:3b`.

## Known blockers / temporary test edits (revert after testing)
These are pre-existing issues that block the local UI test; patch temporarily, then `git checkout`:
1. **Homepage crash** — `pages/index.tsx` news up `HeidiOrchestrator` client-side; its constructor needs the server-only service-role key → `supabaseKey is required`. Temporarily remove that client-side instantiation to render the chat.
2. **Missing `/api/status` + `/api/session`** — `hooks/useHeidi.ts` calls them but they don't exist → UI JSON-parses 404 HTML and throws. Temporarily add stub `pages/api/status.ts` / `pages/api/session.ts` returning valid JSON.
3. **`lib/ModelManager.ts` 5s latency gate** — line ~83 `latency < 5000` discards even successful local responses slower than 5s (separate from the `AbortSignal.timeout`), so any non-trivial local model always routes to the (creditless) API fallback and you get the "safe fallback" message with `Model: api`. Temporarily raise both the gate and the abort timeout to ~30000 to test the local path. (Consider flagging this to the user as a real limitation — it may be worth making configurable.)

## What "working" looks like
- SSE `metadata.model_used` = `local` (NOT `api`/`fallback`).
- UI shows assistant text + an **Actions: • <type>** chip; header shows **Model: local**.
- DB: `actions` has a row from the executor (e.g. `create_task`=`pending`) plus the orchestrator audit row (status reflects the REAL outcome — e.g. `send_email`=`failed` when email unconfigured, never a fake success); `memories` has User+Assistant rows (`embedding IS NULL` when embeddings are off — graceful).

## Devin Secrets Needed
- None for the $0 local path. (For the Anthropic agent path you'd need `ANTHROPIC_API_KEY` with credits, optionally `OPENAI_API_KEY` for real embeddings, and real `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.)
