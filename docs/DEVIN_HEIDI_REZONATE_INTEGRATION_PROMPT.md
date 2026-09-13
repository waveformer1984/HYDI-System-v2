# Prompt for Devin: Heidi ↔ Rezonate Operational Integration (Local-Only)

Copy everything below the line into Devin as a single task.

---

You're picking up the Rezonate work in the `HYDI-System-v2` repo (also called
Heidi / ProtoForge). Prior sessions did a full capability audit, built a
capability-contract system to prevent false status claims, and did async/auth/
storage remediation on Rezonate's canonical app. That work is done and is not your
task. **Your task is different: figure out, and then build, how Heidi — the
platform's orchestrator — should actually manage and operate Rezonate, module by
module, capability by capability, entirely locally.**

No Supabase. No external platforms. This repo's own `CLAUDE.md` documents an
explicit "Local-First Architecture" decision (2026-07-10): LLM inference runs on
Ollama, embeddings run locally, and the data plane is local Supabase-via-Docker at
most — cloud is out. Do not introduce, restore, or depend on any cloud service,
including the cloud Supabase project referenced in old backup env files. If
something currently reaches outside the local machine, treat that as a defect to
flag, not a dependency to build on.

## Read first, in this order

1. `protoforge-applications/rezonate/capability-contract.json` — the ground truth
   for what Rezonate can actually do today. State enum: `PLANNED, SCAFFOLD,
   PARTIAL, FUNCTIONAL, VERIFIED, PRODUCTION, DEPRECATED`. This exists because
   Rezonate's own dashboard UI (`RezonetteModule.tsx`) used to hardcode "Complete"
   for features that were 0% built (NFT minting, marketplace, mixing/mastering) —
   read the file, don't assume the marketing copy anywhere else in the repo is
   accurate.
2. `docs/REZONATE_CANONICAL_STATE.md`, `docs/REZONATE_CONSOLIDATION_PLAN.md`,
   `docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md`, `docs/REZONATE_CANONICAL_PATH.md` —
   full history of what's canonical, what's legacy, and why. In particular:
   `docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md` documents that **four separate
   surfaces** currently touch Rezonate data (canonical API, legacy Vercel API,
   `api/chat/route.js`'s `handleRezonateMessage`, and a stub Edge Function) with no
   single owner — that fragmentation is directly relevant to what you're about to
   do.
3. `protoforge-applications/rezonate/src/api/router.js` and `src/repository.js` —
   the canonical Rezonate app: its real, tested HTTP API and the domain operations
   behind it (projects, tracks, assets, processing jobs, ownership records, rights).
   This is local-only today by default (local JSON/memory persistence via
   `src/persistence/`) — that's correct and should stay the default per
   `CLAUDE.md`.
4. `api/chat/route.js` — search for `handleRezonateMessage`. This is the *only*
   place in the whole repo where "Heidi" (the chat-facing orchestrator) currently
   knows Rezonate exists at all. Read it closely: it's a crude keyword router
   (`if (message.includes('project'))`, etc.) that queries Supabase tables
   *directly*, bypassing the canonical API, the repository layer, and the
   capability contract entirely. It has no idea whether a capability it's about to
   describe is `VERIFIED` or `PLANNED`.
5. `pao-system/core/heidi.controller.ts` — the actual task-routing/orchestration
   core (`taskRoutingMatrix`, `agentRegistry`, event bus). Search it for
   `rezonate` / `Rezonate` — there are currently **zero matches**. Rezonate is not
   a registered agent, has no task types, and is not part of Heidi's routing matrix
   at all. Every other business domain (architecture, energy, procurement,
   construction, fabrication, marketing, etc.) has real entries here; Rezonate
   does not.
6. `api/heidi/route.js` and `api/ursula/status.js` — how Heidi's own orchestration
   endpoint and the system status/health surface work today, so anything you add
   for Rezonate follows the same shape other subsystems use rather than inventing a
   new pattern.
7. `lib/auth/rbac.js` — the `rezonate:manage` permission already exists (operator/
   owner only, no read-only `rezonate:view`). Any new Heidi-side integration must
   respect this, not bypass it.
8. `scripts/validate-rezonate-capability-contract.js` (`npm run
   validate:rezonate-contract`) — the CI guard that keeps status claims honest.
   Anything you wire up must not cause this to start failing, and if you add new
   surfaces that display Rezonate capability status (e.g. a Heidi status response),
   consider whether they need the same discipline.

## The actual objective

Today, "Heidi manages Rezonate" doesn't really mean anything concrete — there's no
registered agent, no task routing, and the one chat-facing integration point
(`handleRezonateMessage`) is disconnected from both the real API and the truth
about what's actually built. Fix that, grounded entirely in what
`capability-contract.json` says is real, not in what any UI or README claims.

Concretely, in this order:

```
1. CAPABILITY INVENTORY
   Re-derive, from capability-contract.json only, which Rezonate capabilities are
   FUNCTIONAL/VERIFIED/PRODUCTION today (safe for Heidi to describe as working or
   invoke) vs. PARTIAL/SCAFFOLD/PLANNED (Heidi must not claim these work, and must
   not attempt to invoke them).
        ↓
2. HEIDI INTEGRATION MAP
   Produce docs/HEIDI_REZONATE_INTEGRATION_MAP.md: for each VERIFIED/FUNCTIONAL/
   PRODUCTION capability, what module owns it (protoforge-applications/rezonate/
   src/...), what the canonical API endpoint is (src/api/router.js), and what
   Heidi-side surface should expose it (chat response, task routing entry, status
   endpoint field). Do the same, explicitly marked "not yet operable," for
   PARTIAL/SCAFFOLD/PLANNED ones — the point is a complete map, not just the easy
   parts.
        ↓
3. TASK ROUTING WIRING
   Register Rezonate as a real entry in pao-system/core/heidi.controller.ts's
   taskRoutingMatrix (or the equivalent mechanism if you determine that file isn't
   actually the right integration point for a revenue-stream app rather than a
   construction/business agent — justify whichever you pick). Task types should
   map onto real, tested canonical-API operations (create project, list tracks,
   run a processing job, etc.) — not aspirational ones.
        ↓
4. REPLACE THE DIRECT-SUPABASE SHORTCUT IN handleRezonateMessage
   Rewrite handleRezonateMessage in api/chat/route.js to call the canonical
   Rezonate app (its repository or its local HTTP API on localhost) instead of
   querying rezonate_projects/rezonate_tracks directly. This removes one of the
   four fragmented data-access surfaces documented in
   docs/REZONATE_API_OWNERSHIP_BOUNDARIES.md, and — just as important — makes
   Heidi's chat answers actually reflect real local state instead of a second,
   independent, drift-prone query path. Preserve its existing response shape/tone
   unless you have a specific reason to change it (say what and why if you do).
   Preserve auth/permission behavior — do not weaken rezonate:manage.
        ↓
5. CAPABILITY-AWARE RESPONSES
   Heidi (via handleRezonateMessage or wherever else you wire this) must consult
   capability-contract.json before describing or attempting a capability. If asked
   about something PLANNED (e.g. NFT minting), Heidi should say so plainly, not
   describe it as available. This is the same discipline the CI guard already
   enforces for the dashboard UI — extend it to Heidi's own responses.
        ↓
6. HEALTH & LIFECYCLE
   Wire Rezonate's existing GET /health endpoint (src/api/router.js) into Heidi/
   Ursula's status surface (api/ursula/status.js or api/health.js — inspect both,
   pick the one that's actually the right layer) so Rezonate's operational state is
   visible the same way other subsystems' health is, locally, with no external
   dependency.
        ↓
7. REGRESSION VALIDATION
   npm test, npm run typecheck, and inside protoforge-applications/rezonate:
   node --test tests/*.test.js. Current baseline: 128 tests, 127 passing, 1 known
   pre-existing EPERM failure (tests/api.test.js, temp-file cleanup, environment-
   specific, not a logic bug) — that failure must remain exactly as-is. If it
   changes, stop and classify before calling anything done. Also re-run
   npm run validate:rezonate-contract — it must still pass.
        ↓
8. CAPABILITY CONTRACT UPDATE
   Update capability-contract.json only from evidence you actually produced (new
   passing tests, a real wiring you verified locally). Add entries for the new
   Heidi-integration surfaces themselves if they're substantial enough to track
   (e.g. "Heidi Task Routing for Rezonate" as its own capability, starting at
   whatever state your evidence actually supports — probably FUNCTIONAL at best on
   day one, not VERIFIED).
```

## Hard constraints

- **Local only.** No Supabase, no cloud calls, no new external dependencies. If you
  find something that currently makes a cloud call on Rezonate's behalf, flag it —
  don't build more integration on top of it without calling that out.
- **Evidence-gated status claims.** Never mark a capability `VERIFIED` or
  `PRODUCTION` because code exists or "should work." A capability contract entry
  needs a passing test or a real local run you performed, with a date.
- **Don't break the capability-contract guard.** `npm run validate:rezonate-contract`
  must still pass after your changes — it checks the contract's internal
  consistency and scans the UI for hardcoded status literals that don't match the
  contract.
- **Don't touch the legacy API's removal status.** `api/rezonate/route.js` /
  `pages/api/rezonate/route.js` stay as-is (`RETAINED_FOR_COMPATIBILITY` per
  `capability-contract.json → _legacy_paths`) — this task is about Heidi's
  integration layer, not about deprecating or removing anything.
- **Don't expand into P2/P3 work.** MIDI CC support, NFT/chain integration, real
  audio classification, mixing/mastering DSP, etc. are explicitly downstream in
  `docs/REZONATE_CONSOLIDATION_PLAN.md` — stay out of them even if a task-routing
  entry tempts you to stub one in.
- **Respect `rezonate:manage`.** Any new Heidi-side path that can trigger a
  Rezonate action (not just read status) must go through the same permission check
  the canonical API already enforces — don't create a second, unguarded path to the
  same actions.
- **Preserve the test baseline exactly.** 128/127/1, same EPERM failure. Investigate
  before concluding anything if that changes.
- Work on a branch and open a PR; don't push directly to `clean-main`.

## What to deliver

- `docs/HEIDI_REZONATE_INTEGRATION_MAP.md` — the full capability → module → API →
  Heidi-surface map, including the explicitly-not-yet-operable capabilities.
- Real code changes: task routing registration, the `handleRezonateMessage`
  rewrite, health/status wiring — each with tests.
- Updated `capability-contract.json`, guard-script-passing.
- A final report in the same shape prior sessions used: what's wired, what's still
  a gap, exact test numbers, exact capability-contract changes (with justification
  for each state), and one concrete recommended next step if the work doesn't reach
  full completion — that's an expected, honest outcome if you hit a real blocker,
  not a failure to avoid reporting.
