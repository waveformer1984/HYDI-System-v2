# Ursula Command Center

Ursula (`apps/ursula-frontend`) is Frank's local command center: one place
to see every app in the portfolio, open it, and see its health — plus an
always-on Heidi chat (later phases).

## Phase 1 — portfolio registry + workspace shell

- `config/portfolio.json` is the **single source of truth** for every app
  Ursula can launch or operate on. `kind` is `local` (repo app, PM2/script
  supervised), `suite` (a blueprint under the Ursula Suite Flask server at
  `http://localhost:5000`), or `external` (off-host link — empty until
  Jordan lists entries).
- `lib/portfolio/loader.js` is the read path: validates the file, returns
  `{ ok, apps, suiteBase, external, errors }`, never throws on a missing
  file. fix-list and runtime-audit will reuse it (not wired yet).
- Ursula's retired `src/lib/appRegistry.ts` (hardcoded paths into the
  stale `HYDI_System` clone) is deleted; `AppLauncherModule` now fetches
  `/api/portfolio`.
- `/apps/[id]` is the per-app workspace: a **Dev** pane (running SHA from
  `.runtime/provenance`, PM2 status, health + dependency health, last 50
  err-log lines, open PRs, matching fix-list items) and an **App** pane
  (iframe of the app's URL when embeddable, otherwise an "Open in new
  tab" button with the reason). A not-running app shows **Start**, which
  posts a `restart-module` mission to heidi-core — Ursula never starts
  processes itself.
- `ursula-local` is registered in `.ports.json` (3100), has a PM2 entry
  (`next start` from a production build — not `next dev`), and a
  `boot.config.json` module **disabled** until Jordan turns it on.
- `switchboard` and `keeper` are **not** given PM2 entries yet — they are
  candidates, listed in the PR.

## Phase 2+ — per-app workspace, Heidi hover

Documented in the phase PRs as they land.
