# Useful Heidi — one-page plan

Goal: 4 phone-visible behaviors in a week. No new services, PM2 apps, schema, or paid APIs.

## What already exists (reuse, don't rebuild)

| Need | Existing piece |
|---|---|
| Phone surface | `/heidi` PWA (`pages/heidi.tsx` → `components/heidi-mobile/*`), BFF `/api/heidi-mobile/*` with device-session guard + CSRF + rate limits |
| Device auth | `devices` table approval (heidi-be3e2b74 approved), HttpOnly session cookie, `x-hydi-device-token` HMAC |
| Deterministic status | `heidi-core/status/system-status.js` — probes heidi-core, memory, Ollama, heidi-web, mobile-chat, protoforge, daemon file, frank-observer (PM2/Docker/disk). Triggers only on exact phrases ("system report", "/status"…) |
| Decision inbox | `heidi-core/status/decision-inbox.js` — `GET /decision-inbox`, `GET /brief` in heidi-core (missions awaiting approval + fix-list CRITs, deduped, read-only) |
| Approval queue UI | `TasksView` + `pages/api/heidi-mobile/tasks.js` → `/api/actions` approve/reject (RBAC `actions:approve`) |
| Governed execution | heidi-core missions/lifecycle (`task approve N`), triple gate `lib/governance/tripleGate.js`, action registry, `HEIDI_ALLOW_EXEC`, `HEIDI_PAUSE` |
| Audit | `auth_audit_log`, `heidi_events`, mission records |
| Model layer | `heidi-core/brain/ollama-client.js` — RAM-budget model pick, `OLLAMA_TIMEOUT_MS`/`LOCAL_MODEL_TIMEOUT_MS` (default 20s), MEMORY_PRESSURED backoff |
| Chat path | phone → `/api/heidi-mobile/chat` → `/api/chat` → `answerViaHeidiCore` → `lib/heidi-core-chat.js streamChat` → heidi-core `/chat-tools` (5-round tool loop) then `/think-stream` |

## Gaps found (inventory, 2026-11-12)

1. **`Think-stream error: phase is not defined`** — `/think-stream` calls `phase()`/`phases()`/`mark`/`cid` but never defines them (they exist only in `/chat-tools`, server.js ~line 740). Every think-stream request dies in the outer catch after the LLM already ran.
2. **No total deadline** — `streamChat` timeout is 180s; `/chat-tools` allows 5 model rounds × ~20s. Worst case minutes of silence.
3. **No model fallback on timeout** — a timed-out `generateStream` goes straight to canned fallback text; no retry with a smaller model.
4. **"status" doesn't route deterministically** — Jordan's word isn't in `isSystemReportQuery`; only exact long phrases are.
5. **No disk-free or CI signal in status** — `checkSystem` covers services but not C: free GB or last local-ci result.
6. **No Google Calendar credentials** — `.env.local` has no GOOGLE_*/calendar keys. Brief will report `calendar: not configured` until Jordan adds an ICS export or OAuth creds.
7. **local-ci results live only as GitHub commit statuses** — brief can read them via public REST API (repo is public; ~60 req/hr unauth is fine for a daily brief).
8. **Approval execution for the 3 new actions doesn't exist** — decision-inbox is read-only; nothing executes `pm2 restart <app>` / `local-ci --pr N` / disk report on approval.

## Deliverable → implementation sketch

**PR1 — Chat that answers** (branch `feat/useful-chat`)
- heidi-core `server.js`: define `cid/mark/phase/phases` in `/think-stream` (copy the /chat-tools pattern).
- `system-status.js`: add `'status'`, `'status?'`, `'how are you', 'what's up'` triggers; add `disk-c` component (C: free GB via `fs.statfs` or `wmic`/PowerShell fallback) and `ci` component (last local-ci status for clean-main head via GitHub API, cached).
- `ollama-client.js`: on stream timeout, retry once with the smallest installed model before giving up.
- `lib/heidi-core-chat.js`: add overall deadline ~12s; on expiry return `{ok:false, reason:'timeout'}` fast.
- `pages/api/chat.ts` + `pages/api/heidi-mobile/chat.js`: on heidi-core timeout/unavailable, emit "Busy right now — try again in a minute." instead of hanging.

**PR2 — Morning brief** (branch `feat/morning-brief`)
- heidi-core `GET /brief/v2` (or extend `/brief`): sections = calendar shifts (Google Calendar if creds exist, else `not configured`), system health (reuse `checkSystem`), open PRs + local-ci status (GitHub API), pending approvals (decision-inbox).
- BFF `pages/api/heidi-mobile/brief.js` (guard + proxy) + `BriefCard` at top of `HeidiMobileApp`/`StatusView`. Cache 15 min server-side.

**PR3 — Approval inbox** (branch `feat/approval-inbox`)
- heidi-core `GET /approvals` + `POST /approvals/:id/decision`: lists 3 allowlisted proposals (pm2 restart named app, local-ci --pr N, disk report) pending Jordan's tap; on approve → verify `HEIDI_ALLOW_EXEC`, triple-gate AUTO-APPROVE or human-approved, action inside bounds → spawn the action, write `heidi_events` audit row, post result back as a card/message.
- BFF `pages/api/heidi-mobile/approvals.js` + Approvals section in app (reuse TasksView patterns).

**PR4 — Disk guard** (branch `feat/disk-guard`)
- `scripts/local-ci.js`: pre-flight `statfs` check — below 12 GB free on the worktree drive, post pending status "skipped: disk <12GB" and exit 0-with-message instead of ENOSPC mid-run; cleanup worktree + jest cache in `finally`.
- heidi-core brief surfaces "CI skipped: disk" when relevant.

## Verification
- Unit: jest tests per PR (phase fix, status triggers, disk guard, approval gating).
- Phone: Jordan opens `/heidi` → "status" <10s; brief card visible; approve "re-run local-ci for #526" → result card.
- If Frank-side testing needed: `node scripts/hydi-verify.js` + manual curl steps in each PR body.
