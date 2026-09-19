# HYDI Production Verification Report — Reconciliation

**Date:** 2026-09-19
**Branch:** `claude/production-verification-report-99hxqe` (based on `clean-main` @ `593ece9`)
**Source report:** operator-supplied "Production Verification Report", produced in a
separate VM session against a working tree that was never pushed.

---

## 1. Executive Status

**NOT READY TO EXPOSE.** The handoff report's own PASS/BLOCKED matrix lists only
external credential steps as remaining. Reconciling it against `clean-main` — the
canonical branch, and the only tree anyone else can review or deploy — surfaces a
**blocking security finding that the report records as a PASS** (§3).

Executing the report's step 2 (`tailscale funnel 3000`) against `clean-main` as it
stands would publish an unauthenticated Heidi orchestrator endpoint to the open
internet. That step must not be run until §3 is resolved.

The gated contract the report describes is real and independently verified here
(§4). The exposure finding is about a *different* endpoint on the same port.

A second finding, outside the source report's scope: **neither CI workflow has
passed on `clean-main` in its last six runs** — both fail within seconds, before any
test executes (§6b). The project currently has no working automated gate.

## 2. What This Report Is, and What It Is Not

The source report documents work performed in a VM this session does not share.
Its claims about that VM's runtime — live HTTP probes against `127.0.0.1:3000` and
`127.0.0.1:3003`, a running `heidi-chat-portal`, a `/tmp/hydi-production-secret.txt`
— **cannot be reproduced or falsified from here.** They are recorded as received,
not re-verified.

What *is* checkable from here is whether the code those probes describe exists on
`clean-main` and behaves as claimed. That is what §3–§5 cover. Where a runtime
claim and the committed code disagree, the code is treated as authoritative for
what will actually be deployed, because the tree that produced the probe results
was never pushed and no longer exists.

Three referenced artifacts are **not in this repository at all**, and nothing here
can speak to them:

| Referenced | Status in `waveformer1984/HYDI-System-v2` |
|---|---|
| `heidi-chat-portal/` (incl. `.env.local`, `heidiCore.ts`, `/api/mobile/chat`, `/api/mobile/status`) | Not present — a separate repository |
| "PR #146", branch `Cusor_agent01hydi-chat-route-contract-63ea` | **PR #146 here is unrelated**: "Fix/heidi migrations security", merged 2026-06-28. The report means PR #146 of the portal repo. |
| Branch `fix/production-hydi-contract-63ea` | Never pushed; not on `origin`. Its contents are unreviewable. |

## 3. BLOCKING: `/api/chat` is unauthenticated on `clean-main`

The source report's §10 records:

> | Legacy `/api/chat` (public Host simulation) | 403 | → **PASS** |

**This is not reproducible on `clean-main`.** `pages/api/chat.ts` — the handler that
serves `POST /api/chat` — performs no authentication of any kind:

- No `verifyServiceToken` import or call
- No `x-hydi-service-token` read
- No `401` / `403` / `Unauthorized` / `Forbidden` path
- No `Host`-header inspection

and there is no gate above it either: the repository contains **no** `middleware.ts`
and no `headers`/`redirects`/`rewrites` rules in `next.config.js`. A host-based
guard does exist elsewhere in the tree — but it is not applied to this route (see
below), which is the whole finding.

This matches, independently, the endpoint analysis in open draft PR
[#272](https://github.com/waveformer1984/HYDI-System-v2/pull/272), which documents
the same finding and treats a 2xx on `/api/chat` with a deliberately invalid token
as a **failure** whenever a public URL is in play.

### Why this inverts the report's conclusion

`/api/chat` and `/api/chat/route` are different handlers on the same port:

| Path | Handler | Auth |
|---|---|---|
| `POST /api/chat/route` | `api/chat/route.js` | HMAC-gated (`x-hydi-service-token`) |
| `POST /api/chat` | `pages/api/chat.ts` | **none** |

`pages/api/chat.ts`'s handler runs straight through — method check, body
validation, then a `200` SSE stream. A well-formed POST is answered regardless of
what token accompanies it.

`tailscale funnel 3000` exposes the port, not a path — so it publishes both.

### Where the report's 403 probably came from

This repository already contains exactly the guard `/api/chat` is missing:
`src/hydi-v3/localAccessGuard.js`'s `requireLocal(req, res)` returns **403
`{ error: 'forbidden' }`** for any non-local request, treating `x-forwarded-for` /
`x-real-ip` / `forwarded` as proof of a proxy hop and failing closed on an unknown
peer address. It is applied to **ten** routes:

```
pages/api/cockpit/{index,briefing,command}.js
pages/api/console/{index,state,health,agents,timeline,approvals,command}.js
```

`pages/api/chat.ts` is **not** among them. A "public Host simulation" probe against
any cockpit or console route returns 403 legitimately — which is the most likely
explanation for the report's result: the right answer, from the wrong endpoint.

### The fix is already in the tree

Apply the existing, tested guard to `pages/api/chat.ts` the same way the cockpit
routes do. `tests/unit/hydi-v3/localAccessGuard.test.js` passes **9/9** here, so
the mechanism needs no new verification — only wiring.

This does not break the documented integration path. A remote portal is required to
call `/api/chat/route` (HMAC-gated), not `/api/chat` — stated in PR #272's
`termux/README.md` and already true of the in-repo clients `docs/index.html` and
`public/hydi-chat.html`. `/api/chat` is Heidi's own local streaming endpoint, so
localhost-only is its correct posture.

**Required before any funnel is opened:** gate `/api/chat` on `clean-main` (apply
`requireLocal`), or block the path at the tunnel, or keep the funnel down.
Re-verify with `termux/hydi-production-connect.sh --public-url …` once PR #272
lands (§5) — with a public URL set, that checker fails on precisely this condition.

## 4. Independently Verified on `clean-main`

Run in this environment against `593ece9`, after `npm install` (931 packages):

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | **PASS** (exit 0) |
| Auth + chat-router + mobile-status units | `npx jest tests/unit/auth.test.js tests/unit/chat-route-rezonate.test.js tests/unit/mobile-status-api.test.js` | **22/22 PASS** |

Assertions covering the contract, all passing:

- `chat router - guards` → rejects a missing service token with **401**
- `chat router - guards` → rejects a token signed with the wrong secret with **401**
- `chat router - guards` → rejects an unknown system with **400**
- `api/mobile-status.js` → rejects unauthenticated requests; rejects wrong-secret
  signatures; returns a snapshot when authenticated; 405 on non-GET

The implementation backing them is present and sound:

- `lib/auth/verifyServiceToken.js` — HMAC-SHA256 over `{ts}:{requestId}:{service}`,
  5-minute replay window, `timingSafeEqual` comparison, fail-closed on every branch.
- `api/chat/route.js` — verifies before dispatch, returns `401 { error, reason }`,
  rate-limited to 30 req/min, CORS restricted to `Content-Type` and
  `x-hydi-service-token`.

So the report's §5 conclusion — *the gated route's auth contract holds* — is
**confirmed**, by source and by test, for `/api/chat/route`.

## 5. Claim-by-Claim Reconciliation

| # | Source report claim | Status on `clean-main` |
|---|---|---|
| 1 | Contract unpushed on `fix/production-hydi-contract-63ea`; push blocked (403 for `cursor[bot]`) | **Already landed.** `lib/auth/verifyServiceToken.js` and the `api/chat/route.js` guard are on `clean-main`, added by `52cd389` (2026-08-26) — predating the handoff session. Whatever else that branch holds is unknown and unreviewable. |
| 2 | `./termux/hydi-production-connect.sh` | **Not on `clean-main`.** Exists only in open **draft** PR #272 (`claude/hydi-system-production-connect-5z1vkz`). The report's operator steps invoke a script that is not yet merged. |
| 3 | `/api/health` → 200, `status: degraded` | Consistent. `api/health.js` returns 200 with `status: 'healthy' \| 'degraded'`; `degraded` means the `system_dashboard` view was unreachable (Supabase/Docker down), which is expected without a live DB. |
| 4 | `/api/mobile/status`, `/api/mobile/chat`, `heidiCore.ts` | Out of scope — portal repo. This repo's analogue is `api/mobile-status.js` (verified, §4). |
| 5 | Unit tests `verify-service-token`, `chat-route-auth-contract` — 14/14 | **No files by those names exist here.** Equivalent coverage lives in `tests/unit/auth.test.js` and `tests/unit/mobile-status-api.test.js` (§4). |
| 6 | `npm run typecheck` PASS | **Confirmed** (§4). |
| 7 | `npm run build` PASS incl. `/push-setup` | `pages/push-setup.tsx` present. Build not re-run here; typecheck passes. |
| 8 | Full `npm test` → 251 failures (integration/Supabase without live DB) | **Count confirmed exactly** (251, twice, deterministic). Cause partly re-characterised: all DB-refusal, but 17 of 27 failing suites are `tests/unit/**`, not integration — §6. |
| 9 | Legacy `/api/chat` → 403 | **CONTRADICTED — see §3.** |
| 10 | No secret leakage (HTML / git diff / logs); `NEXT_PUBLIC_HYDI_SERVICE_SECRET` unused | Consistent with this tree: `HYDI_SERVICE_SECRET` is read server-side only; no `NEXT_PUBLIC_` variant appears anywhere. |

## 6. Full Unit Suite

`npm test` was run twice here against `593ece9`. **Both runs produced identical
totals** — this is deterministic, not flaky:

```
Test Suites:  27 failed, 345 passed, 372 total
Tests:       251 failed, 1 skipped, 4090 passed, 4342 total
Time:        447.9 s
```

**The source report's figure of 251 failures reproduces exactly.** That is a strong
corroboration of its §8, and confirms the number is a property of the repository at
this commit rather than of that VM.

Every failure inspected is a refused database connection — nothing else:

| Port | Service | Seen in |
|---|---|---|
| `127.0.0.1:54321` | Supabase REST (PostgREST) | `tests/migrations/**` — `TypeError: fetch failed … ECONNREFUSED` |
| `127.0.0.1:54322` | Postgres direct (`pool.query`) | `tests/unit/revenue-engine.test.ts` and peers |

The 27 failing suites are 10 under `tests/migrations/` and 17 under `tests/unit/`
(the `heidi-*-qualification`, `heidi-cognitive-*`, `communication-layer`,
`revenue-engine`, `control-plane-convergence`, `conversation-store-*`,
`bounded-cognitive-loop` and `recovery-bridge` suites). None of the failures touch
the service-token contract; `tests/unit/auth.test.js`,
`tests/unit/chat-route-rezonate.test.js` and `tests/unit/mobile-status-api.test.js`
are all in the passing 345.

### One correction to the source report's framing

The report attributes the 251 to *"integration/Supabase tests without live DB
(expected in this VM)"*. The Supabase part is right; "integration" and "this VM"
are not. `jest.config.js` excludes `tests/integration/**` from `npm test` entirely,
so **none** of these failures come from the integration suite — 17 of the 27
failing suites are ordinary `tests/unit/**` suites inside the gate that
`unit-tests.yml` runs on every push and PR.

So this is not a local-environment artifact. It is the repository's real state at
`593ece9`, and it means `npm test` is not currently a signal that can be used to
qualify anything — see §6b.

## 6b. Both CI workflows are failing on `clean-main`

This was not in the source report's scope, but it bears directly on any claim that
the system is verified.

`unit-tests.yml` has concluded **`failure`** on all six most recent pushes to
`clean-main` (runs 558–563), including current HEAD `593ece9`.
`integration-tests.yml` is the same (runs 53–56). The repository has no green CI.

The runs finish in **4–7 seconds**. The test suite alone takes ~448 s, and `npm ci`
for 931 packages takes far longer than that on its own — so these jobs are failing
**before any test executes**, and the 251 DB failures above are *not* what is
turning them red. Run logs have since expired (HTTP 404), so the failing step could
not be identified from here.

Two candidate causes were checked and **ruled out**:

- Not stale action majors — `actions/checkout@v7` and `actions/upload-artifact@v7`
  both resolve to published releases (v7.0.1).
- Not the DB failures — the timing rules that out, as above.

The cause remains open. The PR carrying this report will trigger a fresh run of
both workflows whose logs *will* be readable; that is the cheapest way to identify
the failing step, and it should be done before any further "verified" claim rests
on CI.

Meanwhile, per `CLAUDE.md`, the pre-push hook (`.githooks/pre-push`, typecheck +
full Jest) is the only gate actually running — and it runs the same suite that is
251-red here.

**Observed while pushing this very report:** the hook ran the full suite (401.9 s),
reported the same `27 failed, 345 passed` / `251 failed, 4090 passed`, and aborted
the push:

```
[pre-push] tests failed -- push aborted (use --no-verify to skip)
error: failed to push some refs to 'https://github.com/waveformer1984/HYDI-System-v2'
```

So the practical state of this repository is that **no push can succeed without
`--no-verify`** unless the pusher has local Supabase running on `:54321`/`:54322`.
CI is red before it runs anything, and the local hook is red for want of a database,
so the escape hatch is the normal path — which is how a real regression would get
through unnoticed. This report's own commit was pushed with `--no-verify`
(documented in `CLAUDE.md` as the intended escape) since it adds one Markdown file
and touches no code.

## 7. Corrections to the Handoff Instructions

The source report's operator steps contain four errors that would misfire if run
verbatim:

1. **"open PR against `main`"** → the canonical branch is **`clean-main`**. CI
   (`unit-tests.yml`, `integration-tests.yml`) runs against `clean-main`; `main` is
   not the integration branch.
2. **"PR #146"** → in *this* repo, #146 is "Fix/heidi migrations security", merged
   2026-06-28. The intended PR is #146 of the **portal** repo. Merging or
   re-opening this repo's #146 would be wrong.
3. **`./termux/hydi-production-connect.sh`** → not on `clean-main`. Merge PR #272
   first, or the command will not exist. (It is currently a **draft**.)
4. **Step order** → the report sequences Tailscale (step 2) before any resolution of
   `/api/chat`. Per §3 that ordering publishes an ungated endpoint. Gate first,
   expose second.

## 8. Remaining Actions, Corrected

Ordered so that nothing is exposed before it is safe.

1. **Gate `/api/chat`** on `clean-main` — apply `requireLocal` from
   `src/hydi-v3/localAccessGuard.js`, as `pages/api/cockpit/*` and
   `pages/api/console/*` already do — or commit to blocking the path at the
   tunnel. **Blocks everything below.** (§3)
2. **Merge PR #272** (mark ready for review first) so the connectivity checker is
   available on `clean-main`.
3. **Push `fix/production-hydi-contract-63ea`** from an account with write access,
   and open a PR **against `clean-main`**. Needed to establish whether it carries
   anything beyond what already landed in `52cd389` — including the host gate its
   403 probe implies (§3).
4. **Tailscale:** on the HYDI host, `tailscale funnel 3000`; note the HTTPS URL.
   Then re-verify from outside:
   ```bash
   export HYDI_SERVICE_SECRET=...   # never as an argument
   bash termux/hydi-production-connect.sh --public-url https://<host>.<tailnet>.ts.net
   ```
   With `--public-url` set, the checker treats an ungated `/api/chat` as a failure —
   so this is the gate on step 1 actually being done, not merely believed.
5. **Vercel (`hydi-heidi`):** unblock the account, then set **server-side only**
   (never `NEXT_PUBLIC_*`): `HYDI_API_URL` (the funnel URL, no trailing slash) and
   `HYDI_SERVICE_SECRET` (identical to the HYDI process's value). Deploy after the
   portal repo's PR #146 merges.
6. **Re-run the full check** with both URLs to confirm the path end to end:
   ```bash
   bash termux/hydi-production-connect.sh \
     --public-url https://<host>.<tailnet>.ts.net \
     --heidi-url  https://<portal-host>
   ```

Secret handling per `SECURITY_PROTOCOL.md`: inject directly, never echo, never
commit. The VM-local `/tmp/hydi-production-secret.txt` referenced by the source
report is gone with that VM; generate with `openssl rand -hex 32` and set the same
value on both sides.

## 9. Corrected PASS / BLOCKED Matrix

Scoped to what is true of `clean-main`. Runtime rows from the source report that
cannot be reproduced here are marked **UNVERIFIED** rather than carried over as
PASS — they may well be true of that VM; they are not evidence about this branch.

| Check | Status |
|---|---|
| `npm run typecheck` | **PASS** (verified here) |
| Service-token auth contract, unit-tested | **PASS** (22/22, verified here) |
| `/api/chat/route` rejects missing / wrong-secret tokens | **PASS** (verified here) |
| `api/mobile-status.js` auth contract | **PASS** (verified here) |
| No `NEXT_PUBLIC_HYDI_SERVICE_SECRET`; secret server-side only | **PASS** (verified here) |
| `/api/chat` blocked to public callers | **FAIL — BLOCKING** (§3) |
| `termux/hydi-production-connect.sh` available | **BLOCKED** — draft PR #272 unmerged |
| `fix/production-hydi-contract-63ea` pushed / reviewable | **BLOCKED** — needs an account with write access |
| Tailscale Funnel public URL | **BLOCKED** — and gated behind §3 |
| Vercel portal deploy | **BLOCKED** — account unblock + env vars |
| Production phone/browser E2E | **BLOCKED** — needs the above |
| HYDI local health / local auth probes | **UNVERIFIED** — VM-local, not reproducible here |
| Heidi → HYDI → Heidi E2E | **UNVERIFIED** — portal repo, VM-local |
| `npm run build` incl. `/push-setup` | **UNVERIFIED** here — `pages/push-setup.tsx` present; typecheck passes |
| Full `npm test` | **251 failed / 4090 passed** — all DB-refusal; reproduces the source report exactly (§6) |
| `unit-tests.yml` green on `clean-main` | **FAIL** — red on the last 6 pushes, fails in 4–7 s before tests run (§6b) |
| `integration-tests.yml` green on `clean-main` | **FAIL** — same (§6b) |

## 10. Bottom Line

The auth contract is genuinely solid, and the source report verifies it carefully.
The gap is one of scope, not rigor: it proves `/api/chat/route` is gated, then
reports the *port* as safe to expose. `/api/chat` shares that port and is not gated.

Two findings change the plan:

1. **Do not open the funnel until `/api/chat` is gated.** (§3) The fix is already in
   the tree and tested — it needs wiring, not design.
2. **Neither CI workflow has passed on `clean-main` in its last six runs**, failing
   in seconds before any test runs. (§6b) Until that is diagnosed, "verified" rests
   on local runs and the pre-push hook alone — and the suite that hook runs is
   251-red for want of a database.

Everything else in the handoff stands, with the four corrections in §7. The
service-token contract it set out to prove is genuinely proven (§4); what is not
established is that the port carrying it is safe to expose, or that the project has
a working gate to catch it if that changes.
