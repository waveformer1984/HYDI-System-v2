---
name: testing-heidi-chat
description: Test the Heidi chat pipeline (/api/chat, orchestrator, memory, action execution) end-to-end on a fully-local $0 stack. Use when verifying chat, streaming, memory, or action-execution changes without paid API credits.
---

# Testing Heidi chat end-to-end (local $0 stack)

Heidi's chat has two code paths in `pages/api/chat.ts`:
- **Anthropic agent path** (`lib/heidi-agent.ts`) — native tool-calling + token streaming. Selected when `ANTHROPIC_API_KEY` is set (`isClaudeAvailable()`). Can be exercised $0 against a local Anthropic-compatible proxy — see "Testing the Anthropic native path for $0" below.
- **Fallback orchestrator path** (`lib/orchestrator.ts`) — used when `ANTHROPIC_API_KEY` is unset. Non-streaming (writes the full response over the same SSE contract). Testable fully locally.

UI path (as of PR #162): homepage `pages/index.tsx` is a self-contained full-screen dark chat UI that POSTs `/api/chat` directly and parses SSE events (`metadata` / `content` / `tool` / `actions` / `[DONE]`). It no longer uses `components/Chat.tsx` or `hooks/useHeidi.ts`. The homepage health-checks via `GET /api/status` on mount (only used to flip the Online/Offline badge; see the resolved GOTCHA below for the prior `/api/heidi` 404). Tailwind is wired via `pages/_app.tsx` importing `styles/globals.css`.

**Fallback chain (as of PR #162):** `pages/api/chat.ts` now wraps the Claude agent in a try/catch — if the Anthropic call fails (e.g. depleted credits), it falls through to the legacy orchestrator instead of returning a raw error. Similarly, `lib/ModelManager.ts` now tries OpenAI when Anthropic fails, instead of giving up after the first provider.

## Local $0 stack setup

### 1. Local Supabase (Docker)
- Supabase CLI is a two-binary shim — `supabase` and `supabase-go` must live together. Install the full tarball to `$HOME/.local/share/supabase` and add to PATH (don't just drop the single `supabase` binary in `/usr/local/bin`). Resolve the latest release tag from the `releases/latest` redirect (`curl -sSI .../releases/latest | grep -i location`) — the GitHub API `tag_name` fetch sometimes returns empty and you download a 9-byte file.
- **Do NOT run `supabase start` from the repo root.** It auto-applies the repo's `supabase/migrations`, and at least one migration currently fails (e.g. a `vector(768)` column def), which aborts the whole start and tears down the containers. Instead run `supabase init --force` in a **separate throwaway dir** (e.g. `~/hydi-local-supabase`, which has no migrations) and `supabase start` there. Default API stays `http://127.0.0.1:54321`, matching the app env. Then apply the schema manually (below).
- `supabase start` brings up Postgres at `http://127.0.0.1:54321`. Get keys with `supabase status -o env` (ANON_KEY, SERVICE_ROLE_KEY). Use the **JWT** `ANON_KEY`/`SERVICE_ROLE_KEY` (the app uses supabase-js), not the newer `PUBLISHABLE_KEY`/`SECRET_KEY`. The DB container is `supabase_db_<dirname>` (e.g. `supabase_db_hydi-local-supabase`).
- Apply schema: `docker exec -i <supabase_db_container> psql -U postgres -d postgres < supabase/heidi-init.sql` (creates `memories`, `actions`, `sessions`).
- **Semantic recall needs the `search_memories` RPC.** `lib/heidi-memory.ts` calls `supabase.rpc('search_memories', { query_embedding, match_count, user_id })`. If it's missing, retrieval silently returns `''` (error is swallowed). The definition lives in `heidi-memory-schema.sql`. Two gotchas when creating it locally:
  - The input param `user_id` collides with an output column named `user_id` in the `RETURNS TABLE` (`parameter name "user_id" used more than once`). Drop the duplicate output columns — the app only reads `content`. Qualify the WHERE as `search_memories.user_id`.
  - If the local `memories.created_at` is `timestamp` (not `timestamptz`), a function declaring `created_at timestamptz` fails at call time with `42804 ... does not match expected type`. Easiest fix for testing: omit `created_at` from the function's `RETURNS TABLE`. A minimal working local def: `RETURNS TABLE (id uuid, session_id text, content text, similarity float)`.
  - Verify directly before blaming app code: `POST /rest/v1/rpc/search_memories` with the service-role key and a 1536-length `query_embedding` array; expect rows with a `similarity` field.
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

## Testing $0 local semantic memory recall (Ollama embeddings, as of PR #120)
`lib/embeddings.ts` supports a local **Ollama** embeddings provider, so memory recall works with **no paid OpenAI key**.

1. Pull the embeddings model: `ollama pull nomic-embed-text` (768-dim; smoke-test `POST localhost:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"hi"}'`).
2. Add to the dev-server env: `EMBEDDING_PROVIDER=ollama` and `OLLAMA_EMBEDDING_MODEL=nomic-embed-text` (keep `OPENAI_API_KEY` unset). `getEmbeddingProvider()` honors the explicit `EMBEDDING_PROVIDER` first.
3. Ollama vectors (768) are **zero-padded to 1536** (`toEmbeddingDim`) to match the `memories.embedding vector(1536)` column — cosine-preserving, so similarity search still works.

**Adversarial UI test for recall** (a broken embeddings path would visibly fail this):
- The orchestrator prompt (`lib/orchestrator.ts` `buildPrompt`) injects ONLY the embedding-retrieved memory — **no conversation history**. The UI regenerates `session_id` on every page load (`pages/index.tsx:7`) with a constant `user_id='demo-user'` (`hooks/useHeidi.ts:62`).
- So: (a) state a fact in the chat ("my favorite color is teal, my flagship project is Rezonate"), (b) **reload** the page (new session, empty transcript), (c) ask for the fact. A correct answer can ONLY come from semantic retrieval. If embeddings/RPC are broken the model says "I don't have that information".
- Confirm storage: `select left(content,40), (embedding is not null), vector_dims(embedding) from memories where user_id='demo-user'` → expect `vector_dims = 1536`.
- Clear `demo-user` rows first (`delete from memories where user_id='demo-user'`) for an unambiguous run.

## Verifying the fixes (as of PR #116, no temp edits needed)
The 3 bugs that previously required throwaway patches are **fixed**. Expected healthy behavior:
1. **Homepage renders on its own** — `pages/index.tsx` no longer instantiates `HeidiOrchestrator` client-side; it `fetch('/api/status')`. No `supabaseKey is required` crash.
2. **`/api/status` + `/api/session` are real endpoints** — `GET /api/status` returns `{model_status, memory_connected, allowed_actions:[5 items]}`; `GET /api/session?session_id=x` returns the session row or `null` (200); missing `session_id` → 400. The StatusPanel shows `Memory Connected: Yes`, `Allowed Actions: 5`.
3. **Local responses >5s are accepted** — with `LOCAL_MODEL_TIMEOUT_MS` raised, a ~6–10s local response returns `model_used: "local"` (not `api`) and persists. Confirm in the dev log (`POST /api/chat 200 in <N>ms`, N>5000) and in the `actions`/`memories` tables.

Quick end-to-end check: send `Create a task to email the quarterly report to finance` in the chat → expect `Model: local`, an assistant reply, a `create_task` action chip, and a new `actions` row with `task_name='create_task'`.

## RESOLVED: homepage Online/Offline badge previously hit a dead `/api/heidi` (fixed)
`pages/index.tsx` used to poll `POST /api/heidi {action:'status'}` on mount for its Online/Offline badge. `/api/heidi` only exists at root `api/heidi/route.js` (Vercel app-router `route.js`) and is **deliberately not bridged into `pages/api`** — it has zero authentication and forwards arbitrary prompts to a cloud LLM fallback if those keys are ever configured, so bridging it as-is would be a live cost/DoS vector (see `ISSUES_FOUND.md` #53). Under `next dev`/`next start`, `POST /api/heidi` returned **404**, so the badge was permanently stuck "Offline" regardless of real health. Fixed by repointing the mount-time health check at `GET /api/status` (`pages/api/status.ts`, already bridged and safe) instead — it has no `currentModel` field, so the model name badge still only ever gets set from the first chat response's `metadata` SSE event, same as before. Do not repoint this back at `/api/heidi` without adding real auth to `api/heidi/route.js` first.

## Truthfulness check (P0 real-action-execution)
If the model picks `send_email`, it should log as `failed` ("Email not configured") rather than a fake success — this confirms real action execution (no `Math.random()` fake-success).

## Testing the Anthropic native path for $0 (no real Claude credit)
The native agent path (`lib/heidi-agent.ts`: token streaming + `tool_use` loop) can be exercised **without paying** because the Anthropic SDK honors the **`ANTHROPIC_BASE_URL`** env var. Point it at a local **LiteLLM** proxy that speaks the Anthropic Messages API and is backed by Ollama. **No app code changes — env vars only.**

1. `pip install "litellm[proxy]"`. Config (`/tmp/litellm_config.yaml`):
   ```yaml
   model_list:
     - model_name: claude-local
       litellm_params:
         model: ollama_chat/llama3.2:3b   # ollama_chat (not ollama) supports tools
         api_base: http://localhost:11434
   litellm_settings:
     drop_params: true
   ```
2. `litellm --config /tmp/litellm_config.yaml --port 4000`. Sanity-check the Anthropic endpoint directly before wiring the app:
   `curl localhost:4000/v1/messages -H 'x-api-key: sk-local-dummy' -H 'anthropic-version: 2023-06-01' -d '{"model":"claude-local","max_tokens":256,"tools":[...],"messages":[...]}'` — expect a `content[].type=="tool_use"` block and `stop_reason:"tool_use"`. Add `"stream":true` to confirm SSE (`content_block_delta`/`text_delta`).
3. Start `next dev` with the local Supabase env PLUS: `ANTHROPIC_API_KEY=sk-local-dummy`, `ANTHROPIC_BASE_URL=http://localhost:4000`, `ANTHROPIC_MODEL=claude-local`. (Unset `ENABLE_LOCAL_MODEL` — that's only for the fallback path.) This makes `isClaudeAvailable()` true → `runHeidiAgentStream`.
4. Send a task message in the chat UI. Expect SSE `metadata.model_used == "claude-local"`, token-by-token `content` deltas, a `tool`/`actions` event, and a new `actions` row whose id matches the task id in the reply. The tool loop can take ~30s on CPU (`MAX_TOOL_ITERATIONS=6`).

**Fidelity caveat:** this proves the *code path* (SSE streaming, `tool_use`→`tool_result` loop, `ActionExecutor`, memory) — NOT Claude's reasoning quality, since a local model drives the tool calls via the proxy's translation. For real Claude, set a credited `ANTHROPIC_API_KEY` and unset `ANTHROPIC_BASE_URL`.

## What still can't be tested $0
- **Real Claude reasoning quality** — the proxy approach above validates wiring, not Claude itself. Needs `ANTHROPIC_API_KEY` **with credits** (a creditless key returns `400: "Your credit balance is too low"`).
- **OpenAI embedding semantic recall (hosted)** — needs `OPENAI_API_KEY` quota. NOTE: semantic recall itself IS testable $0 via the local Ollama embeddings provider (see "Testing $0 local semantic memory recall" above); only the *hosted OpenAI* variant needs quota.

## Devin Secrets Needed
- `ANTHROPIC_API_KEY` — only needed (with credit) to test **real Claude** quality. The native code path itself is testable $0 via the LiteLLM proxy with a dummy key.
- `OPENAI_API_KEY` — only for real embedding-based memory recall (must have quota).
- None required for the local $0 fallback path or the $0 LiteLLM Anthropic-path test (local Supabase + Ollama + LiteLLM supply their own).
