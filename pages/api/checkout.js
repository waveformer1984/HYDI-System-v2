// Bridges the Vercel-style handler in api/checkout.js into Next.js's actual
// routing surface. Next.js's pages router only ever serves pages/api/*
// (never a bare top-level api/ directory, which is a Vercel-platform-only
// convention) -- since this deployment runs via `next dev`/`next start`
// rather than Vercel (see CLAUDE.md's Local-First Architecture section),
// /api/checkout was previously unreachable, meaning HYDI tier checkout
// sessions could not be created in production. See ISSUES_FOUND.md.
export { default } from '../../api/checkout.js';
