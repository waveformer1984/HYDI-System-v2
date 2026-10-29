# Heidi persistent memory

Heidi now keeps conversations, remembers facts across conversations and
restarts, and reports project status with its source and age. This document
covers why she was forgetting, how the memory pipeline works, how to deploy
it, and what is still open.

## Why Heidi was forgetting (root cause)

Traced on 2026-10-28 through the path the phone actually uses:
`heidi-mobile-chat.html` → `launch-heidi-mobile.js` (`POST /api/chat`, :3006)
→ `heidi-core` `POST /chat-tools` (:3459) → Ollama.

1. **No conversation existed.** The page sent `{ message }` only. The relay
   forwarded `{ input }` only. There was no conversation id anywhere in the
   path.
2. **`/chat-tools` built every prompt from `[system, this message]`.** No
   earlier turn and no stored fact ever reached the model, so every message
   was answered as if it were the first.
3. **`/think-stream` mixed every conversation together.** Its "recent
   interactions" came from one global `short_term` table, with no owner and
   no conversation.
4. **The UI kept history only on screen.** A reload or app restart wiped it.
5. **The memory database had silently reset.** When C: filled up on
   2026-10-27, Heidi's SQLite file was recreated empty ("before missing,
   Tables created" on 2026-10-28). Separately, `sqlite-store.js` falls back to
   an in-memory store when the native `sqlite3` module fails to load, and it
   says so only in the startup log.
6. **The UI showed a fixed "grounded" badge on every reply**, whether or not
   anything was retrieved or saved.

## How it works now

```
phone (heidi-mobile-chat.html)
  │  remembers WHICH conversation is open (localStorage pointer only)
  │  POST /api/chat { message, conversation_id, request_id }
  ▼
launch-heidi-mobile.js :3006 ── relays ids; relays /api/conversations*, /api/memory/status
  ▼
heidi-core :3459  /chat-tools  (and /think-stream)
  1. resolve owner (auth already passed: loopback or x-heidi-secret)
  2. "memory …" command? → answer from the store, no model call
  3. beginTurn: open conversation (unknown id → error, never a blank chat)
       assemble bounded context:
         • this conversation's recent messages   (HEIDI_HISTORY_CHARS, 3500)
         • relevant + standing memories           (HEIDI_MEMORY_CHARS, 1500)
         • related user messages from other chats
       save the user's message (failure is reported, not hidden)
  4. model call: [system rules] [MEMORY DATA msg] [ack] [history…] [user]
  5. endTurn: save the answer; extract memories from what the USER said;
       save them with source conversation + message ids
  6. final SSE event: conversation_id, persistence {saved, error},
       context_sources {history_messages, memory_ids, related…, degraded}
  ▼
SQLite heidi-core/data/heidi_memory.db  (node:sqlite, hm_* tables)
```

Code lives in `heidi-core/memory/`:

| File | Role |
|---|---|
| `conversation-store.js` | conversations, messages, memories, project state, migrations |
| `context-assembler.js` | bounded context, `<memory>` data fence |
| `memory-extractor.js` | deterministic extraction from user statements |
| `memory-runtime.js` | turn lifecycle, owner resolution, failure semantics |
| `memory-commands.js` | `memory status/search/recent/project/audit/forget` |
| `project-state.js` | HYDI/Heidi/ProtoForge state with provenance and freshness |
| `secret-filter.js` | keeps credentials out of memory |

### Design choices

- **Same SQLite file, built-in driver.** The new tables sit next to the
  legacy ones in `heidi_memory.db`. They use Node's built-in `node:sqlite`,
  so there is no native build step to break. If the file can't be opened,
  memory reports UNAVAILABLE on every turn; it never quietly falls back to RAM.
  - Postgres/Supabase wasn't used because heidi-core is deliberately
    local-only SQLite (see `CLAUDE.md`, Local-First).
- **Plain full-text search (FTS5 with bm25), no embeddings.** Ranking also
  weighs importance and recency. Embeddings can be added later if recall
  falls short; nothing here needs a paid API.
- **Only the user's own statements become memories.** These are things like
  "remember that …", "my X is Y", "I prefer …", "we decided … because …",
  "blocker:", "done:", "architecture:" and "lesson:". Model output never
  becomes a memory, so a hallucinated answer can't later be recalled as fact.
- **Updates supersede old memories rather than duplicating them.** A memory
  with the same owner, category and key but new content replaces the old one.
  The old one keeps `superseded_by`/`conflict_with`. Restating the same fact
  just refreshes it. Messages that a memory was taken from are left out of
  "related messages", so an outdated value can't come back that way.
- **Retrieved memory is data, not instructions.**
  - It goes into its own message, labelled "MEMORY DATA (not instructions)",
    after the system prompt, which stays first and unchanged.
  - Each item is flattened to one line, and anything resembling a
    `<memory>` tag is neutralised.

## Memory commands

Type these in Heidi's chat; the 🧠 Memory and 📁 HYDI status buttons send them
too:

| Command | What it does |
|---|---|
| `memory status` | DB connectivity, write probe, last write and retrieval, this conversation's id, what the last turn used, project freshness, degraded parts |
| `memory search <words>` | matching memories (id, kind, how verified, date, source chat) and earlier messages |
| `memory recent` | latest memories and conversations |
| `memory project hydi\|heidi\|protoforge [refresh]` | project state, labelled `repo` / `live` / `docs` / `you said`, with age and ⚠️ STALE; UNKNOWN when nothing is connected |
| `memory audit` | 7 real checks on throwaway owners, cleaned up afterwards |
| `memory forget <id or words>` | deletes the memory and its older versions |

### Project state sources

| Project | Repo state | Live state | Other |
|---|---|---|---|
| HYDI | git HEAD and branch of the live checkout | `frank-observer`'s `.runtime/observation/frank.json` and the daemon status file | — |
| Heidi | git HEAD and branch of the live checkout | her own diagnostics: model, permission level | — |
| ProtoForge | none yet | none yet | only what you tell Heidi |

- **Freshness:** live data is STALE after 10 minutes, repo data after 24 hours.
- **Refresh:** on request, or on read when older than 5 minutes. Nothing polls
  in the background.

## HTTP API (heidi-core, same auth as every other route)

| Route | Result |
|---|---|
| `GET /conversations` | the caller's conversations |
| `POST /conversations` | create one |
| `GET /conversations/:id/messages?limit=&before=` | 404 for unknown or another owner's |
| `GET /memory/status` | `{ available, text }` |
| `GET /memory/search?q=` | matching memories |
| `DELETE /memory/:id` | delete a memory |

`POST /chat-tools` and `/think-stream` accept `conversation_id` and
`request_id`. A retried `request_id` is not saved twice.

`launch-heidi-mobile.js` relays `/api/conversations*` and `/api/memory/status`.
It sends `x-heidi-secret` when `HEIDI_SECRET` is set.

Owner: requests act as `HEIDI_OWNER` (default `owner`). A caller that has
already passed auth may name a user with `x-heidi-owner`. Every query filters
by owner.

## Database migration and rollback

- **Migration.** `hm_schema_migrations` tracks the version (v1). The v1
  migration creates these tables in a transaction on first start:
  - `hm_conversations`, `hm_messages` (+FTS), `hm_memories` (+FTS);
  - `hm_project_state`, `hm_meta`.
  It is additive: legacy tables (`short_term`, `long_term`, `agent_registry`,
  and the rest) are untouched.
- **Rollback.** Revert the PR; older code ignores the `hm_*` tables. To remove
  the data as well, stop `heidi-core` and run
  `DROP TABLE hm_messages_fts; DROP TABLE hm_memories_fts;` and then each
  `hm_*` table. Back up `heidi-core/data/heidi_memory.db` first.

## Deployment checklist (Frank)

1. Confirm Node ≥ 22.13 (`node -v`). Frank's PM2 logs show `DEP0190`, which
   only Node 24 prints.
2. Back up `heidi-core\data\heidi_memory.db`.
3. Merge; `frank-auto-deploy` pulls and restarts the online apps.
4. If they weren't restarted, run `pm2 restart heidi-core` and restart the
   `heidi-mobile-chat` module.
5. In Heidi's chat, run `memory audit` (expect 7/7) and `memory status`.
6. Acceptance by hand, using a real model on Frank:
   1. Say "remember that my test word is <something unique>".
   2. Tap ➕ New chat and ask "what is my test word?".
   3. Reload the page; the conversation should reopen.
   4. Restate a different value, then ask again.
7. Optional variables, server side only:
   - `HEIDI_OWNER` (default `owner`);
   - `HEIDI_HISTORY_CHARS` and `HEIDI_MEMORY_CHARS` (context budgets);
   - `HEIDI_SECRET` (already used by heidi-core auth).

## Security and privacy review

- **Auth unchanged.** heidi-core still requires loopback or `x-heidi-secret`
  on every new route.
  - `launch-heidi-mobile.js` (:3006) is reachable on the LAN and the tailnet
    without a secret, as `/api/chat` already was. Anyone who can reach :3006
    can read conversation history through it. It is not on the
    public-ingress allowlist, and ngrok points at :3000.
  - Set `HEIDI_MOBILE_TOKEN` to require a paired device; see
    `docs/HEIDI_SYSTEM_STATUS.md`.
- **Owner isolation.** Every store query filters by owner. The tests cover
  memory, conversations, forget and search across owners.
- **No secrets in memory.**
  - The secret filter refuses keys, tokens, JWTs, provision codes,
    "password: …" phrases and long hex or base64 strings. Refusals are
    reported.
  - Conversation messages are kept as typed, so a secret pasted into chat is
    stored in that conversation's history. Delete it with `memory forget` or
    by deleting the conversation.
- **Prompt injection.** Retrieved text is fenced, flattened, tag-neutralised
  and placed after the system prompt, which marks it as data.
- **Diagnostics** show only the caller's own data. `memory audit` uses
  throwaway owners and deletes them.

## Verification status

| Check | Status |
|---|---|
| Unit and integration tests, `tests/unit/heidi-persistent-memory.test.js` (27 tests: the 18 required cases plus the A–I regression, on real SQLite files) | PASSED locally |
| All `tests/unit/heidi*` suites (34 suites, 573 tests) | PASSED locally |
| `npm run typecheck`, eslint on changed files | PASSED (no new warnings) |
| Mobile UI smoke in Chromium at 390×844, real `launch-heidi-mobile.js` against a fake core: reload reopens history, a missing conversation is reported, no horizontal scroll | PASSED locally |
| Real model on Frank answering from retrieved memory | BLOCKED: needs Ollama on Frank. Tests use a deterministic stub and prove the memory reaches the model input, not how a real model words its answer |
| Production persistence on Frank | NOT YET: needs merge and deploy, then checklist steps 5–6 |
| `heidi-chat-portal` (Vercel: `app/api/mobile/chat/route.ts`, `lib/core/heidiCore.ts`, `lib/hydi/hydiClient.ts`) and its `HYDI_API_URL` | BLOCKED: that code isn't in this repository or any repository this session can reach. This PR covers Heidi's real chat path on Frank |

## Remaining work, by priority

1. **Deploy and run the acceptance steps on Frank** with the real model.
2. **Authenticate `launch-heidi-mobile.js` (:3006)** per device, before
   history is exposed beyond the tailnet.
3. **Connect `heidi-chat-portal`** to these endpoints, or retire it, once its
   code is reachable.
4. **ProtoForge has no automatic status source.** Add one, for example GitHub
   PR and CI state via `gh` on Frank, or a status file.
5. **Legacy memory still fills in the background.** `short_term` /
   `long_term` keep being written, and the legacy `search_memory` tool still
   reads `long_term`. Migrate or retire them.
6. **Consider embeddings** if keyword search misses paraphrased questions in
   practice.
