# Heidi Mobile — security options (decision doc for Jordan)

**Status:** Options only — no behavior changes until you pick. Context from `docs/HEIDI_MOBILE.md` (Known, pre-existing issue) and older mobile clients.

---

## (a) `POST /api/chat` (`pages/api/chat.ts`) — partial auth today

### Current state

- Mutating intents (goals, missions, governed commands, life-flow writes, task approve paths, etc.) already require a valid `x-hydi-service-token` via `chatAuthorized()`.
- **Unauthenticated today:** streaming chat for read-ish / conversational traffic — any caller that can reach port 3000 can open an SSE session and consume tool-using agent output without a service token.
- **Callers affected if chat required auth for all traffic:**

| Caller | Credential today | Break if "require auth always"? |
|--------|------------------|----------------------------------|
| `pages/index.tsx` (dashboard Heidi) | Operator enters `HYDI_SERVICE_SECRET` in ⚙️ settings → mints HMAC per request | **No** — already can send token |
| `pages/api/heidi-mobile/chat` BFF | Device cookie; upstream chat call | **Yes, unless BFF is extended** — BFF must attach service token or a new device-scoped chat gate |
| `hydi-mobile-protoforge.html` / legacy pages | Often **no** token on `/api/chat` | **Yes** — breaks until retired or updated |
| `docs/index.html` (GitHub Pages) | `HYDI_SERVICE_SECRET` in localStorage | **No** if already signing; **Yes** if using bare `/api/chat` |
| Loopback operators / scripts | Mixed | Needs token in env or header |

**Size of change (rough):**

| Option | Scope | Effort / risk |
|--------|--------|----------------|
| **A — Require service token on every `/api/chat` POST** | `pages/api/chat.ts` early gate + BFF relay adds server-side token for approved devices; migrate legacy HTML callers | **Medium** — 1 core route, 1 BFF, 2–3 legacy HTML/docs touchpoints, tests |
| **B — Require device token (same as `/api/status/system`)** | Reuse `requireAuth` / device HMAC on chat; Heidi Mobile BFF already has device context | **Medium-high** — chat stream is long-lived SSE; device token refresh and denial semantics need design |
| **C — Keep open but gate** (status quo + ingress) | Rely on `lib/security/ingressGate.js` for public tunnels; document LAN/tailnet trust boundary | **Small** — docs + verify allowlist; does not fix LAN attacker on :3000 |
| **D — Retire unauthenticated path** | Deprecate bare `/api/chat` for browsers; only BFF + dashboard with credentials | **Medium** — same as A but explicitly delete legacy paths |

### Recommendation: **Option A**

Require `x-hydi-service-token` for **all** `/api/chat` traffic (fail closed with the existing `AUTHORIZATION_REQUIRED` SSE message for anonymous callers). Extend `pages/api/heidi-mobile/chat.js` to attach the service token server-side for **approved** devices only (secret never on phone). Migrate or retire `hydi-mobile-protoforge.html` and any bare `/api/chat` usage in static clients. Dashboard already has the pattern.

---

## (b) Older mobile clients — secrets in `localStorage`

### Current state

| Client | Secret on phone | Risk |
|--------|-----------------|------|
| `docs/index.html` (GitHub Pages) | `HYDI_SERVICE_SECRET` in `localStorage`, HMAC in browser | Full operator capability if XSS or physical access to unlocked phone |
| `hydi-mobile-protoforge.html` | Device signing key in `localStorage`; token in SSE URL | Key exfiltration = device impersonation |

`/heidi` (PWA) uses HttpOnly session cookie + device HMAC derived server-side — **no long-lived secret in JS storage**.

### Options

| Option | What you get | What breaks |
|--------|--------------|-------------|
| **1 — Retire legacy clients** | Single surface (`/heidi`); no browser-held service secret | GitHub Pages users must switch URL; bookmarked `docs/index.html` stops working |
| **2 — Keep but gate** | Leave files deployable; add banner + block on tailnet unless `?legacy=1`; ingress already 404s many paths publicly | Still vulnerable on LAN if someone opens legacy page |
| **3 — Repoint legacy to BFF only** | Change Pages client to call `/api/heidi-mobile/*` only (device pairing flow); remove secret from localStorage | **Medium** rewrite of `docs/index.html`; protoforge HTML needs same or retirement |
| **4 — Short-lived pairing only** | Legacy pages require one-time pair → cookie, no permanent secret storage | Similar to `/heidi`; two UIs to maintain |

**Callers:** Operators using GitHub Pages mobile chat, any bookmark to `hydi-mobile-protoforge.html`, Termux scripts that reuse stored secrets.

**Size:**

- **Retire (1):** Small code (archive links + docs); **operational** cost is retraining/bookmarks.
- **Gate (2):** Small–medium (static HTML + ingress docs).
- **BFF repoint (3):** Medium–large (duplicate much of `/heidi` client in static shell).
- **Pairing (4):** Large (two PWAs converging).

### Recommendation: **Option 1 + timeline**

Announce retirement of `docs/index.html` and `hydi-mobile-protoforge.html` after `/heidi` is the default on Tailscale (already preferred in ops docs). Keep GitHub Pages shell as **UI-only** redirect to `/heidi` on the operator's tailnet host with no secret fields. Do not invest in parallel auth for legacy storage.

---

## Pick checklist (for Jordan)

- [ ] **(a)** A / B / C / D — default recommendation **A**
- [ ] **(b)** 1 / 2 / 3 / 4 — default recommendation **1**
- [ ] Deadline for legacy client shutdown (if 1 or 3)
- [ ] Whether GitHub Pages should redirect only (no HYDI API from Pages origin)

No implementation until these are recorded (e.g. reply in chat or a short `docs/HEIDI_MOBILE.md` maintainer note after decision — out of scope for this doc-only PR).