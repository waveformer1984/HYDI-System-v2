# Archived: orphaned Keymaker/break-glass prototypes

Moved here 2026-07-16, closing out the follow-up flagged in
`ISSUES_FOUND.md`'s "Investigated, not fixed (out of scope for this pass)"
section during the 2026-07-15 security audit.

All three files were confirmed unreferenced by any `require()`/`import`
anywhere else in the repository before being moved:

- **`keymaker-core.js`** (was `modules/keymaker-core.js`) — implements the
  same `process.env.KEYMAKER_SECRET || 'default-secret-change-me'`
  hardcoded-fallback anti-pattern already fixed elsewhere in the codebase.
  The live `Keymaker` used by `src/server.js` is the unrelated
  `src/middleware/keymaker.js`, which has no such fallback. This file was
  never wired to anything.
- **`break-glass-implementation.js`** (was
  `emergency/break-glass-implementation.js`) and **`keeper-break-glass.js`**
  (was `keeper/emergency/break-glass.js`) — prototype break-glass
  token-verification implementations with hardcoded HMAC secrets
  (`'break-glass-time-secret'`, `'break-glass-secret'`) directly in source,
  each self-documented in its own comments as non-production
  (`// In production, use proper secret`). Superseded by the live,
  hardened `supabase/functions/keeper-break-glass` /
  `keeper-break-glass-simple` Edge Functions (fail-closed if
  `KEEPER_BREAK_GLASS_TOKEN` is unconfigured — see `SECURITY.md`).

Kept for reference rather than deleted, matching the convention already
established by `archive/src-esm-orphans/`. If nothing has needed to
resurrect these within a reasonable window, a future pass can delete them
outright.
