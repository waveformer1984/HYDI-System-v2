# Plan: require service token on all `/api/chat` (Option A)

**Status:** Approved direction — **not implemented**. Jordan chose Option A over the options in [HEIDI_MOBILE_SECURITY_OPTIONS.md](./HEIDI_MOBILE_SECURITY_OPTIONS.md). This document is the implementation plan only.

**Non-goals for the first PR:**

- No retirement of `docs/index.html` or `hydi-mobile-protoforge.html` until Jordan confirms usage.
- No service token in browser code, `localStorage`, or client-visible storage.

---

## Goal

Every `POST /api/chat` request must present a valid `x-hydi-service-token`. Conversational SSE and tool-using traffic fails closed with the existing `AUTHORIZATION_REQUIRED` pattern when the token is missing or invalid.

Mobile `/heidi` keeps working: the **server-side** Heidi Mobile BFF attaches the token on upstream calls for **approved, non-pending** devices only. The phone never holds `HYDI_SERVICE_SECRET`.

---

## Current behavior (baseline)

| Path | Auth today |
|------|------------|
| `pages/api/chat.ts` | `chatAuthorized()` on **mutating** intents and some task-decision commands; streaming chat often open without token |
| `pages/api/heidi-mobile/chat.js` | Device approval via `ensureDeviceApproved`; upstream uses `x-hydi-device-token` only (`lib/heidi-mobile/hydiClient.js`) |
| `pages/index.tsx` dashboard | Operator-supplied secret → HMAC per request |
| Legacy static clients | May call `/api/chat` without token |

`isLocalConsoleRequest()` treats loopback without forwarding headers as trusted for some chat paths — insufficient once **all** chat requires a service token (Tailscale-terminating proxies may look like loopback with forwarded headers).

---

## Proposed changes (phased)

### Phase 1 — Core gate

1. **`pages/api/chat.ts`**
   - At the start of the POST handler (before streaming body work), require `chatAuthorized(req)` for **all** requests unless an existing, documented exception remains (e.g. explicit health/debug-only routes — none today on chat).
   - Reuse `refuseUnauthorized(res, 'chat')` for SSE clients.
   - Document that loopback alone is **not** sufficient when forwarded headers are present.

2. **Tests**
   - Extend `tests/unit/*` (or chat route tests) asserting: no header → refusal; valid `mintServiceToken` / fixture token → stream allowed.
   - Regression: dashboard chat still works when settings secret is configured.

### Phase 2 — Mobile BFF (preserve `/heidi`)

1. **`lib/heidi-mobile/hydiClient.js`** (or small helper `lib/heidi-mobile/service-token.js`)
   - When `HYDI_SERVICE_SECRET` is set and `opts.attachServiceToken === true`, add `x-hydi-service-token` using the same HMAC scheme as `lib/auth/verifyServiceToken.js` / `lib/billing/client.ts` (`mintServiceToken` pattern).
   - Never log or return the secret.

2. **`pages/api/heidi-mobile/chat.js`**
   - After `ensureDeviceApproved`, call upstream with **both** device token and service token.
   - If secret missing on server → 503 with existing BFF diagnostic shape (no secret in response).

3. **Tests**
   - `tests/unit/heidi-mobile-api.test.js`: chat relay includes `x-hydi-service-token` on upstream fetch mock when device approved.
   - Upstream 401 from chat auth → readable phone error.

### Phase 3 — Callers and docs (no legacy removal)

1. **`docs/HEIDI_MOBILE.md`** — record Option A as decided; legacy pages **unchanged** until Jordan confirms retirement.
2. **Ingress** — confirm `lib/security/ingressGate.js` allowlist still covers customer paths; chat is not public by default.
3. **Optional follow-up (Jordan approval only):** migrate `docs/index.html` to BFF-only or redirect to `/heidi` **without** storing secrets in the browser.

---

## Mobile access preserved

```
Phone (/heidi)
  → POST /api/heidi-mobile/chat  (cookie session, device HMAC to HYDI on other routes)
  → BFF: approved device + server HYDI_SERVICE_SECRET → mint x-hydi-service-token
  → POST /api/chat (loopback upstream)
```

Requirements on Frank / production:

- `HYDI_SERVICE_SECRET` in heidi-web PM2 env (already required for many routes).
- Device pairing unchanged.

---

## Verification (when implemented)

| Check | Command / note |
|-------|----------------|
| Hermetic unit | `npx jest` targeted chat + heidi-mobile-chat tests |
| Typecheck | `npm run typecheck` |
| Tier 2 DB | **Not** covered by default `npm test` — run `npm run test:local` only when local Supabase is up |
| Manual | Paired phone sends chat; unauthenticated `curl` to `/api/chat` on tailnet → auth refusal |

---

## Rollback

- Revert Phase 1 gate to mutating-only auth (restore prior `chatAuthorized` placement).
- Remove BFF service-token header attachment.

---

## Ownership

- **Cursor / PR:** `pages/api/chat.ts`, `lib/heidi-mobile/*`, tests, docs.
- **Frank:** deploy only after recovery checks; requires `npm run build` before heidi-web shows changes (see [MOBILE_OPERATIONS.md](./MOBILE_OPERATIONS.md)).