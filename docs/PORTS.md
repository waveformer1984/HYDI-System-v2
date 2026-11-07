# Port Registry

> Generated from `.ports.json` by `scripts/gen-ports-doc.js`. Do not edit by hand —
> edit `.ports.json` and regenerate (`node scripts/gen-ports-doc.js`).
> Validate with `node scripts/check-ports.js`.

| Service | Port | Env var | Description | Depends on |
|---|---|---|---|---|
| `heidi-mobile-chat` | 3006 | `HEIDI_MOBILE_PORT` | HEIDI Mobile Chat API — Ollama/LM Studio chat endpoint for mobile clients | ollama |
| `next-app` | 3000 | `PORT` | Next.js DashHub Frontend — React dashboard and admin UI | supabase |
| `protoforge-core` | 3005 | `PORT` | ProtoForge Core (CASCADE/KILO/ProtoForge + Agent Bus) — Event pipeline and agent bus backbone | supabase |
| `heidi-core` | 3459 | `HEIDI_PORT` | HEIDI Core Orchestrator — Central AI orchestration and agent routing | supabase, ollama |
| `heidi-advisory` | 3461 | `HEIDI_ADVISORY_PORT` | HEIDI Advisory Mode API — Approval/reject API for autonomous decisions (heidi-agent.js, HEIDI_ADVISORY_MODE=true only) | supabase |
| `heidi-bridge` | 5050 | `HEIDI_BRIDGE_PORT` | Heidi Bridge (Flask/Python) — System monitoring and status bridge | supabase |
| `ollama` | 11434 | `OLLAMA_PORT` | Ollama Local LLM Server — Local embeddings and inference | — |
| `supabase` | 54321 | `SUPABASE_DB_PORT` | Supabase Local (PostgreSQL) — Local dev database (if using supabase start) | — |
| `keeper` | 3017 | `PORT` | Keeper Agent Server — Keeper agent execution API (moved off 3001 — rezonate-app owns 3001) | — |
| `switchboard` | 3018 | `PORT` | Switchboard UI/API — Switchboard operator console (moved off 3001 — rezonate-app owns 3001) | — |
| `ursula-local` | 3100 | `URSULA_PORT` | Ursula Command Center (local) — Ursula portfolio console — next start -p 3100 (production build, PM2 ursula-local) | — |
| `supabase-rest` | 3001 | `SUPABASE_REST_PORT` | Supabase REST API — Local PostgREST endpoint | supabase |
