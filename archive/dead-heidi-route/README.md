# Archived: `api/heidi/route.js`

Moved here 2026-09-24 while resolving `ISSUES_FOUND.md` #53.

This was the Vercel-style copy of the Heidi local-model chat endpoint. It
was never bridged into `pages/api/`, so under `next dev`/`next start` it was
unreachable, and nothing in the repo called `/api/heidi/route` except the
self-description in `api/agent-manager/agents.js`'s `AGENT_REGISTRY` (now
pointed at the live `/api/chat`).

The live version of this handler is `pages/api/heidi.js` (`POST /api/heidi`),
a near-identical copy that *was* reachable, with no auth and no rate limit.
That route is now gated by `requireAuth` with the `heidi:chat` permission.
Kept for reference rather than deleted, matching the convention of the other
`archive/dead-*` directories.
