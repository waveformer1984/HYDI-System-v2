# Rezonate API Ownership Boundaries

Written 2026-08-13, P1 #4 (`docs/REZONATE_CONSOLIDATION_PLAN.md`). Describes which
surface owns which data and which auth model each uses, as of the P1 remediation
session. This is a description of current reality, not a target state — see
`docs/REZONATE_TARGET_ARCHITECTURE.md` and `docs/REZONATE_CANONICAL_PATH.md` for
where things are headed.

## The four surfaces that touch Rezonate data today

| # | Surface | Entry point | Data it owns/touches | Auth |
|---|---|---|---|---|
| 1 | **Canonical API** | `protoforge-applications/rezonate/src/api/router.js` | Its own `repository.js` → pluggable `Store` (local JSON/memory by default; opt-in `SupabaseStore` covering `projects`/`tracks` only, P1 #5) | `lib/auth/requireAuth`, permission `rezonate:manage`, on by default (P1 #6) |
| 2 | **Legacy Vercel API** | `api/rezonate/route.js`, `pages/api/rezonate/route.js` | Directly queries `rezonate_*` Supabase tables (all 5 that exist in the migration) | `lib/auth/requireAuth`, permission `rezonate:manage` (pre-existing, predates P1) |
| 3 | **Heidi chat router** | `api/chat/route.js` → `handleRezonateMessage()` | Reads `rezonate_projects`, `rezonate_tracks` directly via a raw Supabase client — a **third**, independent query path, not routed through either API above. Also reads `ledger` (filtered `revenue_stream = 'rezonate'`) and `system_health`. | Whatever `api/chat/route.js`'s own request handling enforces upstream (not part of this audit — this doc is scoped to the two dedicated Rezonate APIs) |
| 4 | **Supabase Edge Function** | `supabase/functions/rezonate-engine/index.ts` | Declares 8 task types; all are stub handlers (see `cloud_edge_functions` in `capability-contract.json`, state `SCAFFOLD`) | JWT-required per `supabase/config.toml` (not in the public/no-JWT list) |

## What this means concretely

The canonical API and the legacy API do **not** share a data path today. The
canonical API's default `Store` is local JSON/memory; even when a caller opts into
`SupabaseStore` (P1 #5), it talks to `rezonate_projects`/`rezonate_tracks` the same
tables the legacy API reads — but through a completely separate code path with its
own serialization, not a shared client or repository. Two live writers to the same
tables via two different adapters is a known risk if both are ever active against the
same Supabase project simultaneously; today it's moot because the canonical API
defaults to local storage, not Supabase.

`handleRezonateMessage()` in `api/chat/route.js` is a third, independent reader of
`rezonate_projects`/`rezonate_tracks` — it queries Supabase directly rather than
calling either API. This is the specific dependency that makes the legacy API
`RETAINED_FOR_COMPATIBILITY` rather than removable (see `_legacy_paths` in
`capability-contract.json`): even if the legacy API's own HTTP surface had zero
external callers, this in-process consumer would still need migrating first.
Migrating it onto the canonical API — or onto a shared data-access layer — is P1 #9
("migration of the remaining canonical CRUD"), and is **deliberately deferred**, not
done in this session: `handleRezonateMessage()` is a live, currently-relied-upon
behavior with no local reproduction of its production Supabase data available in this
sandbox, so a cutover here isn't safely verifiable. Cutting it over blind, without a
way to confirm the replacement returns equivalent results against real data, is
exactly the kind of "clean it up to look prettier" move this project's constraints
warn against.

## Auth boundary specifics

Both dedicated APIs (canonical and legacy) gate on the same permission,
`rezonate:manage`, via the same underlying mechanism (`lib/auth/requireAuth` +
`lib/auth/rbac.js`). Only the `operator` role (and `owner`, which has `*`) holds that
permission — `viewer` and `agent` do not. There is currently no read-only permission
(e.g. `rezonate:view`) distinct from `rezonate:manage`, so a `viewer`-role caller
cannot even list projects through either API today. That is an existing platform-wide
RBAC gap, not something introduced or fixed in this session — noted here because it's
directly relevant to "API ownership boundaries" and should inform any future RBAC
change, not because it was in scope to fix.

`handleRezonateMessage()` and the Edge Function are outside `lib/auth/rbac.js`'s
`rezonate:manage` permission entirely; they have their own, separate auth surfaces
(chat-router-level and Supabase JWT respectively) not reviewed as part of this P1
pass.

## Boundary going forward

Per `_canonical_path` in `capability-contract.json`, the canonical API
(`protoforge-applications/rezonate/src/api/router.js`) is the intended single owner
of Rezonate CRUD. Until P1 #9/#10 land, the legacy API and `handleRezonateMessage()`'s
direct queries remain live, parallel owners of the same underlying Supabase tables —
this is the accepted current state, tracked explicitly rather than hidden.
