// Bridges the Vercel-style handler in api/health.js into Next.js's actual
// routing surface. Next.js's pages router only ever serves pages/api/*
// (never a bare top-level api/ directory, which is a Vercel-platform-only
// convention) -- since this deployment runs via `next dev`/`next start`
// rather than Vercel (see CLAUDE.md's Local-First Architecture section),
// /api/health was previously unreachable despite being documented as a
// live endpoint. See ISSUES_FOUND.md for the full writeup.
export { default } from '../../api/health.js';
