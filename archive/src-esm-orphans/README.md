# Archived: orphaned ESM-syntax files under `src/`

Moved here 2026-07-15 during a production-readiness sweep.

`net.js`, `server-clean.js`, and `persistence.js` use native ES module
syntax (`import`/`export`), but the project has no `"type": "module"` in
`package.json` and no `.mjs` extension on these files — Node's default CJS
loader would throw `SyntaxError: Cannot use import statement outside a
module` on any attempt to `require()` or directly execute them. This also
made them fail ESLint with a parsing error (`'import' and 'export' may
appear only with 'sourceType: module'`).

A repo-wide grep confirmed all are unreachable in practice:

- `net/net.js` (exporting `NET_FETCH`) — zero references anywhere outside
  itself.
- `server-clean.js` — an alternate, never-wired "clean" Express entry point
  (`src/server.js` is the one actually run). Not referenced by any script,
  Dockerfile, Procfile, or other source file.
- `services/persistence.js` — only ever imported by `server-clean.js`,
  so it became unreachable the moment that file did.
- `db/dbRouter.js` / `db/local.sqlite.js` — `dbRouter.js` imports
  `local.sqlite.js`, but nothing imports `dbRouter.js` itself.
- `lib/supabaseClient.js` — the only repo-wide hit outside itself is a
  string literal inside a KILO hypothesis (`kilo.js`'s
  `handleInfrastructureFailure`, a suggested repair manifest that is never
  auto-executed per KILO's no-execution-authority design), not a real
  `import`/`require`.

None of these appear in `package.json` scripts, PM2/ecosystem config,
or any Dockerfile. Archiving them carries no deployment risk and removes a
dead, syntactically-broken island from the active `src/` tree.

If a real ESM entry point is wanted later, these can be resurrected with a
proper `.mjs` extension (or a `type: "module"` `package.json` scoped to a
subdirectory) and reconnected deliberately.
