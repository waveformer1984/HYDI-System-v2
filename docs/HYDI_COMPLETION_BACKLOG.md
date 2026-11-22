# HYDI completion backlog (live register)

Master audit: [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587)  
Last updated: 2026-11-21 UTC (Devin on Frank — audit #587 close-out, steps 1–6 evidence)

## Environment access matrix

| Environment | Verified? | Notes |
|-------------|-----------|-------|
| Cursor Cloud VM | **Yes** | Linux, repo at `/agent/repos/HYDI-System-v2`, `next dev` :3000, `npm run build` OK |
| GitHub + Actions | **Yes** | `clean-main` @ `6d80c587`, open PRs listed below |
| Frank / heidi-pc (Windows) | **Yes** | Audited 2026-11-21: PM2 dedupe done, schedulers coalescing fix, ~1.4 GB avail RAM observed — RAM-constrained |
| Android / Termux | **No** | No device path; use Termux bundle (see #587) when needed |
| Tailscale to Frank | **No** | Not configured on cloud VM |
| Local Supabase (Docker) | **Yes** | `127.0.0.1:54321/54322` is production; `hydi_facts` embedding cutover to vector(768) applied + backfilled 43/43 (VERIFIED) |

## Completion matrix (selected components)

Legend: **I** implemented · **N** integrated · **T** tested (automated) · **D** deployed · **O** operational (live evidence)

| Component | I | N | T | D | O | Blocker |
|-----------|---|---|---|---|---|---|
| Six-layer `lib/pipeline` | ✓ | ✓ | ✓ | ? | ? | Live Frank not audited |
| `cascade-complete-v2` → pipeline | ✓ | ✓ | ✓ | ? | ? | Requires protoforge-core up |
| Heidi Mobile BFF `/api/heidi-mobile/*` | ✓ | ✓ | ✓ | ? | ? | Pairing needs secrets on host |
| Mobile fabric `health.check` | ✓ | ✓ | ✓ | — | — | #585 merged; E2E needs paired device |
| Mobile typed ops catalog | ✓ | ✓ | ✓ | — | — | Runners execute on **host**, not cloud |
| `next dev` `/heidi` | ✓ | ✓ | ✓ | — | — | Fix in open **#586** (not merged) |
| Heidi persistent memory (`heidi-core`) | ✓ | ? | ✓ | ? | ? | Needs heidi-core + SQLite/DB on host |
| Execution fabric missions | ✓ | ? | ✓ | ? | ? | Approval path needs live stack |
| GitHub Pages `docs/**` | ✓ | ✓ | ? | ? | — | **DEFERRED** — workflow manual-only (PR #648); Pages needs owner enablement |
| Health Monitor workflow | ✓ | — | — | — | — | DB step removed (PR #648); **frank-observer is the live monitor** |
| `public/client-dashboard.html` | ✓ | — | — | ✓ | — | **Removed** (PR #647); key remains in git history — rotation is owner action |
| hydi-schedulers supervisor | ✓ | ✓ | ✓ | ✓ | ✓ | Coalescing bug fixed 2026-11-21; 10 jobs cycle correctly; libuv exit fix in PR |
| PM2/config drift audit | ✓ | ✓ | ✓ | ✓ | ✓ | ORPHAN verdict added 2026-11-21; 25/25 unit tests pass |
| hydi_facts embeddings | ✓ | ✓ | ✓ | ✓ | ✓ | **VERIFIED** — vector(768), 43/43 rows, `retrieve_similar_facts` returns ranked hits |
| Distributed-cloud live activation | — | — | — | — | — | **DEFERRED** (owner decision: revenue first; Frank RAM-constrained) |

## Open PR disposition (2026-11-15)

| PR | Title | Recommendation |
|----|-------|----------------|
| **#586** | `/heidi` dev provenance bundle fix | CI green on `68b086a0`; merge when approved (unblocks cloud dev validation) |
| #532–#537 | Dependabot | Review semver/runtime impact; do not auto-merge |

**Merged recently:** #585 (mobile fabric health disposition truthfulness).

## Prioritized findings

| ID | Severity | Finding | Evidence | Next step |
|----|----------|---------|----------|-----------|
| F-001 | Medium | Supabase **anon** key embedded in `public/client-dashboard.html` | Lines 61–62; JWT payload role `anon` | **RESOLVED (pending merge)** — page deleted in PR #647; key stays in git history, rotation is owner action |
| F-002 | Low | Health Monitor skips when `SUPABASE_URL` unset | `.github/workflows/health-monitor.yml` | **RESOLVED (pending merge)** — DB step removed in PR #648; frank-observer is the live monitor |
| F-003 | Medium | PR #586 not on `clean-main` | Open PR; dev `/heidi` 500 without it on pre-fix tree | User merge approval |
| F-004 | High (env) | Frank operational state unknown | No SSH/Tailscale | **RESOLVED** — audited on-host 2026-11-21: PM2 dedupe (8 duplicate apps removed), `frank-auto-deploy` stopped, scheduler coalescing bug fixed, worktree cleanup done |
| F-005 | Medium | Mobile E2E not proven on Frank | #586 PR text; cloud only sees pairing UI | `HYDI_SERVICE_SECRET` + device approval on target host |
| F-006 | Info | `CascadeCompleteV2` **does** call full pipeline | `processEvent` → `pipeline.run` | Close “skips ledger” concern for current `clean-main` |
| F-007 | Low | `GET /api/mobile-status` → 401 without auth on VM | `curl` 2026-11-15 | Expected; document for mobile clients |

## Acceptance tests (status)

| Test | Status | Evidence |
|------|--------|----------|
| A Conversation continuity | **PARTIAL — VERIFIED retrieval, live chat degraded** | `retrieve_similar_facts` returns ranked facts (VERIFIED, local Supabase); heidi-core fact storage hit pre-existing schema-cache mismatch (`hydi_facts.source` column) — separate bug, not embedding-related |
| B Mobile access | **PARTIAL** | Cloud: `/heidi` 200, pairing UI; no paired send/receive |
| C Task execution | **PARTIAL — VERIFIED (simulated scope)** | hydi-schedulers runs 10 jobs as `--once` children on Frank; outcomes recorded in `.runtime/hydi-schedulers.json` (VERIFIED); full mission E2E not run |
| D Approval enforcement | **NOT RUN** | Hermetic tests exist; live not run |
| E Event pipeline | **VERIFIED (embeddings leg)** | Migration `20261117000000_hydi_facts_embedding_768.sql` applied; column is vector(768); backfill 43/43 rows; pgvector query path exercised via `retrieve_similar_facts` |
| F Model resilience | **PARTIAL** | Ollama `nomic-embed-text` serving embeddings on Frank; chat-model failover observed falling back under memory pressure |
| G Recovery | **NOT RUN** | |
| H Resource stability | **VERIFIED (observed)** | Frank ~1.4 GB avail RAM; hydi-daemon ~500–646 MB (tsx runtime compile — precompile plan drafted); C: disk growth under investigation |
| I Security | **PARTIAL → improved** | client-dashboard anon key removed (PR #647, history remains — owner rotation); drift audit now flags PM2 ORPHAN apps |
| J Deployment integrity | **VERIFIED (PM2 layer)** | PM2 dedupe: 7 duplicate scheduler apps + `ollama-serve` deleted, `frank-auto-deploy` stopped, `pm2 save` persisted; `ecosystem.config.js` confirmed single supervisor |

## 2026-11-21 Frank close-out evidence (VERIFIED on host)

- **PM2 dedupe**: `hydi-watchdog`, `hydi-revenue-reconciliation`, `hydi-failed-webhook-retry`, `hydi-model-prep-executor`, `hydi-stuck-job-scheduler`, `hydi-daily-loop`, `hydi-protoforge-scout`, `ollama-serve` deleted as standalone apps — all run once via `hydi-schedulers` supervisor; `frank-auto-deploy` stopped (stays stopped until RAM >2.5 GB and C: >20 GB free); `pm2 save` persisted.
- **hydi-schedulers coalescing fix**: queued/in-flight flags were written to different objects, so every job ran once per boot and never again — fixed; full cycle verified in `.runtime/hydi-schedulers.json`.
- **Orphan audit**: `lib/runtime/drift-audit.js` now reports PM2 apps absent from `ecosystem.config.js` as ORPHAN (`pm2-logrotate` allowlisted); 25/25 unit tests pass.
- **Embeddings 768 cutover** (PR #625 runbook): backup taken, migration applied, backfill 43/43, HNSW index created, `retrieve_similar_facts` verified.
- **libuv exit crash** (`exit_3221226505` / 0xC0000409): `process.exit(0)` after async Supabase cycles raced handle teardown in `revenue-reconciliation-scheduler.js` and `failed-webhook-scheduler.js` — graceful-drain fix prepared.
- **Distributed-cloud live activation**: **DEFERRED** — owner decision, revenue first; Frank is RAM-constrained (~1.4 GB avail).

## Smallest Frank read-only probe (requires approval to run)

```powershell
# On heidi-pc (Frank) — read-only, paste output to #587 (no secrets)
cd C:\Users\Owner\HYDI-System-v2
git rev-parse HEAD
git status -sb
pm2 jlist | node -e "const j=[];process.stdin.on('data',d=>j.push(...JSON.parse(d)));console.log(j.map(p=>({name:p.name,status:p.pm2_env.status,pid:p.pid})))"
npm run runtime:audit
curl -s -o NUL -w "heidi-web:%{http_code}\n" http://127.0.0.1:3000/health
```

## Termux read-only probe (Android)

```bash
# Termux — network reachability only
curl -sS -o /dev/null -w "heidi:%{http_code}\n" "http://HEIDI_HOST:3000/heidi"
curl -sS -o /dev/null -w "api_health:%{http_code}\n" "http://HEIDI_HOST:3000/api/health"
```

Replace `HEIDI_HOST` with tailnet hostname or LAN IP.