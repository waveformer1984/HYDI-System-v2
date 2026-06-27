# HYDI / ProtoForge — System State & Game Plan

_Generated for today's working session. Scope: home↔mobile synergy, full chat, actionable Hydi autonomy, and ProtoForge revenue-engine development._

---

## 1. Current state (verified this session)

**Network / mesh — DONE.**
Tailscale tailnet `tailc50af2.ts.net`. `heidi-pc` (Windows 11) and `felicias-microwave` (Android) connected. MagicDNS on, key expiry disabled on heidi-pc, HTTPS certs enabled. `tailscale serve` fronts port 3000 → `https://heidi-pc.tailc50af2.ts.net/` (tailnet-only, valid cert, verified 200). Android always-on VPN + battery exemption set. `Frank` (3rd node) powered off — join commands ready.

**Runtime / boot — DONE.**
`scripts/boot-agent.js` + `boot.config.json` boot protoforge-core (`:3005`, `/health`) → heidi-web (`:3000`) → in-proc orchestrator, dependency-gated. Autostart via the single `HYDI Boot Agent` scheduled task (nssm removed). Core reports healthy: 11,253 events, integrity 1.0, pipeline healthy, enforcement operational. Ollama (`:11434`) healthy with 4 local models. heidi-bridge Flask on `:5050`.

**Data layer — PROVISIONED (live), not yet in migration history.**
Created in Supabase: `offers`, `reflections.reflection_data`, `system_telemetry`, `worker_queues`/`worker_status`/`worker_events` + 4 queue functions, `push_subscriptions`. Telemetry 404 flood and worker crash-loop both resolved. Tracked migrations `20260617000002-04` written + tested (702 tests passing) but applied ad-hoc, so `schema_migrations` still reads `20260527000001` as newest.

**Code fixes — DONE in repo.**
Root page no longer instantiates the orchestrator client-side (no service-role-key leak; fetches `/api/heidi` status). React 19 + `ws` added. `NODE_ENV=production` removed (the `jsxDEV` 500).

**Open blockers.**
1. `.env` corrupted by a bad append — `scripts/repair-env.ps1` ready; needs the `LIPI_V2` acct id and adds `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Two repos: `HYDI_System` (canonical, all fixes) vs `HYDI-System-v2` (stale; Next.js/python sometimes launched from here). Must consolidate.
3. `DATABASE_URL` password rotated → direct DB tooling + `supabase db push` blocked.
4. Supabase billing notice (outstanding invoices) → risk of project pause.

---

## 2. Today's priorities (ordered)

### P0 — Stabilize the foundation (≈30 min)
- [ ] Run `scripts\repair-env.ps1` (fixes `.env`, adds the browser publishable key). Supply `LIPI_V2` acct id from Stripe → Connect.
- [ ] Resolve the repo split: pick `HYDI_System` as canonical; confirm the running `next dev`, python bridge, and scheduled task all point here. Archive/rename `HYDI-System-v2` to avoid split-brain.
- [ ] Commit the scoped change set; `npx jest tests/migrations` green; restart the boot agent.
- [ ] Restore `DATABASE_URL` (Supabase → Settings → Database) so `supabase db push` can record migration history.
- [ ] Clear the Supabase billing notice (account action) before it pauses the project — this would take Heidi's whole data layer down.

### P1 — Home ↔ Mobile synergy (the real build) (≈2–3 hr)
The mesh is done; the **app** isn't mobile-ready. Nothing currently writes to or sends from `push_subscriptions`.
- [ ] **Installable PWA**: add `public/manifest.json` (name, icons, `display: standalone`, `start_url: /`) and link it in `pages/_document` / `<Head>`. Lets the phone "Add to Home Screen" and run Heidi full-screen over the tailnet.
- [ ] **Service worker**: add `public/sw.js` registered on load — offline shell + `push` / `notificationclick` handlers.
- [ ] **Web push wiring** (the `push_subscriptions` table is waiting):
  - Generate VAPID keys; store the private key server-side, expose the public key as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
  - `POST /api/push/subscribe` → upsert into `push_subscriptions` (device_id, endpoint, p256dh, auth).
  - Server send path (web-push) so Heidi can notify the phone on revenue events, drift alerts, task completions.
- [ ] Verify end-to-end from `felicias-microwave`: open `https://heidi-pc.tailc50af2.ts.net/`, install, allow notifications, receive a test push.

### P2 — Full chat capability (≈1 hr)
- [ ] Resolve the `pages/api/chat.js` **vs** `pages/api/chat.ts` duplication (Next will only honor one; delete the stale one) — likely cause of inconsistent chat behavior.
- [ ] Confirm the chat path end-to-end on the phone: `Chat.tsx` → `useHeidi` → `/api/chat` → `HeidiOrchestrator` (server-side) → model stack. Verify local-first (Ollama) with API fallback, and that memory reads/writes hit `memories` (RLS service-role).
- [ ] Smoke-test a multi-turn conversation on both devices simultaneously (shared tailnet endpoint, distinct sessions).

### P3 — Make Hydi actionable (autonomy) (≈1–2 hr)
The queue system now exists, so the worker fleet can actually run.
- [ ] Verify the Supabase Edge Function workers (`action-worker`, `agent-worker`, `tool-executor`) dequeue via `dequeue_task` and report into `worker_status` (the missing-table crash is gone).
- [ ] Fix the two core-loop bugs so the Observe→Decide→Act loop runs clean:
  - `this.getRecentRevenue is not a function` — `this`-binding loss in `src/core/HeidiCoreLoop.js` (defined at L900, called at L434). Bind the loop handler or call via arrow.
  - `this.reflectiveMemory.whatFailed.set is not a function` — `src/memory/HeidiMemorySystem.js` rehydrates `whatFailed` as a plain object on some load paths; ensure `_toReflectiveMap` runs before first `.set` (L258).
- [ ] Define the allowed action set end-to-end (`send_email`, `create_task`, `update_database`, `fetch_data`, `schedule_event`) with real handlers behind `enqueue_task`, so Heidi's suggested actions actually execute.

### P4 — ProtoForge systems & revenue engines (ongoing)
- [ ] With `offers` now present, exercise the revenue pipeline: lead → quote → proposal → `checkout_sessions` → Stripe Connect payout → `ledger`. Walk one test transaction per active stream.
- [ ] Confirm all 6 Stripe Connect sub-accounts resolve (`galactic_bytes`, `detailer_bot`, `lipi_v2`, `protogrance_aromatics`, `rezonate`, `waveformer_studio`) — `LIPI_V2` was the one lost in the `.env` damage; restore it.
- [ ] Reconcile migrations into history (`supabase db push`) once `DATABASE_URL` is fixed, so the schema is reproducible and the governance gate stays green.
- [ ] Wire `system_telemetry` into a dashboard view (the data now lands) for per-stream revenue + agent-bus throughput.

---

## 3. Suggested order for today

1. **P0** end-to-end first (env, repo consolidation, commit, restart, DB password, billing) — nothing else is trustworthy until the foundation is clean and single-sourced.
2. **P2** chat dedup + verify (fast, unblocks the core product on mobile).
3. **P1** PWA + push (the headline "home↔mobile synergy" deliverable).
4. **P3** core-loop bug fixes + worker verification (turns Hydi from "healthy" to "acting").
5. **P4** revenue pipeline walk-through + migration history.

---

## 4. Watch items / risks
- **Split-brain repos** are the highest-leverage risk: every fix applied to the wrong folder is wasted. Resolve P0 #2 before building anything new.
- **Supabase billing** pause would take down the entire data layer (chat memory, revenue, telemetry, queues). Treat as urgent.
- **Sandbox-mount corruption** (what damaged `.env` and the combined SQL): all destructive/secret-touching edits run on heidi-pc, not from the assistant sandbox. Read-only analysis and new-file creation from the assistant are safe.
- **Migration history drift**: live DB is ahead of `schema_migrations`; reconcile via `db push` so a clean redeploy doesn't diverge.
