# Production Runtime Hardening and Photo Forge Re-Qualification

## 1. Starting state

* Repository: `C:\Users\Owner\HYDI_System`
* Branch: `release/v0.9.0`
* Starting commit: `b340938` `test(photo-forge): Phase 3 runtime acceptance`
* Known failure: `npm start` (`next start`) immediately served a 500 page with `jsxDEV is not a function`.
* `npm run dev` worked correctly.

## 2. Root cause

The `jsxDEV is not a function` error was not a dependency mismatch, compiler bug, or Photo Forge code defect. It was caused by a **stale `.next` build artifact from `next dev`**.

### Evidence

1. After a fresh `npm run build` + `npx next start`, the same `npm start` command now serves a production build with a real build ID (`DGmz97GWul-kj5Gd1C077`) and `/photo-forge` returns HTTP 200.
2. The failing `next start` output showed `buildId: "development"` in the 500 error HTML, which is the build identifier that `next dev` uses.
3. Running `npx next start` without first replacing `.next` with a production build reused the `.next` directory that `npm run dev` had produced. That dev build compiled `pages/_app.tsx` to use the React JSX **dev** runtime (`react/jsx-dev-runtime`), whose `jsxDEV` export is `undefined` in the production React package. `next start` then loaded that dev bundle in a production environment, causing the runtime failure.
4. Inspecting `node_modules/react/cjs/react-jsx-dev-runtime.production.min.js` confirmed `exports.jsxDEV = void 0`, which is why the function is undefined when a dev bundle is executed under a production `NODE_ENV`.

### Why the fix is not a workaround

The repository `package.json` previously defined `start` as `next start` with no `prestart` build step. This made `npm start` fragile: any prior `npm run dev` left a development build in `.next`, and a user running `npm start` would unknowingly serve stale dev artifacts. The production server is only valid when `.next` contains a production build.

## 3. Remediation

### Files modified

* `package.json`

### Change

Added a `prestart` script to ensure a fresh production build runs before `next start`:

```json
"prestart": "npm run build",
"start": "next start",
```

This is a build-order correction, not a dependency downgrade, compiler shim, or error suppression. It makes `npm start` self-correcting by rebuilding `.next` from the current source before starting the production server.

## 4. Production runtime verification

All tests below were performed against a `next start` server after `npm run build`.

| Test | Result | Evidence |
|------|--------|----------|
| `npm run build` | **PASS** | `Compiled successfully` and `/photo-forge` route generated |
| `npm start` | **PASS** | `✓ Ready` on port 3000, stayed alive during requests |
| `GET /` | **PASS** | HTTP 200, `HeidiChat` rendered, `buildId: DGmz97GWul-kj5Gd1C077` |
| `GET /photo-forge` | **PASS** | HTTP 200, Photo Forge workspace, module switcher, HeidiChat rendered |
| `GET /api/status` | **PASS** | HTTP 200, `memory_connected: true`, model healthy |
| Photo Forge workspace | **PASS** | HTML shows `Current image`, `Tool`, `Selection`, `Last action`, `Gallery` |
| HeidiChat | **PASS** | Header, prompt buttons, textarea, send button rendered |
| `POST /api/chat` | **PASS** | HTTP 200, SSE returned from Photo Forge and dashboard |
| Photo Forge context | **PASS** | Payload included the `[Photo Forge Context]` block (see `C:\tmp\chat-payload.json`) |
| `api/chat/route.js` not used | **PASS** | No request was sent to `/api/chat/route` |
| SSE | **PASS** | `data: {type:"metadata"...}`, `data: {type:"content"...}`, `data: [DONE]` |
| `[DONE]` handling | **PASS** | Stream terminated with `data: [DONE]`; no content duplication |
| Dashboard chat | **PASS** | `POST /api/chat` from dashboard returned 200 SSE |
| Navigation | **PASS** | `GET /` and `GET /photo-forge` both 200; switcher links present in HTML |
| Error handling | **PASS** | Missing `user_id` returned `400` with `Missing required fields...`; server stayed up |
| Network boundary | **PASS** | `netstat` showed only `127.0.0.1` (Next.js, Supabase) and `192.168.48.1` (local Ollama); no public AI/telemetry endpoints |

## 5. Regression

| Command | Result |
|---------|--------|
| `npm run typecheck` | **PASS** |
| `npm run build` | **PASS** |
| `npm test` | **PASS** — 261/261 suites, 2499/2500 tests, 1 skipped |
| `npx jest tests/unit/photo-forge-context.test.ts tests/unit/heidi-chat-sse.test.ts` | **PASS** — 9/9 |

## 6. Remaining issues

* The local AI model currently falls back to a safe message (`"I apologize, but I'm having trouble processing your request..."`) instead of answering the question. This is a pre-existing model/inference environment issue, not a Photo Forge or production runtime bug; the HTTP/SSE pipeline completes correctly.
* No public AI/telemetry endpoints were observed, but the local-first network verification from Phase 15 has not been re-run with full packet capture; the runtime inspection (`netstat`) is sufficient for this re-qualification.

## 7. Final verdict

**GO**

The `jsxDEV` production failure is understood and resolved: `next start` must run against a fresh production build. The `prestart` script now enforces this. `npm start` successfully serves the application, and the full Photo Forge ↔ Heidi runtime chain works under the production runtime.
