# HYDI completion backlog (live register)

Master audit: [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587)  
Last updated: 2026-11-15 UTC (Cursor Cloud Agent, Phase 1–3 initial pass)

## Environment access matrix

| Environment | Verified? | Notes |
|-------------|-----------|-------|
| Cursor Cloud VM | **Yes** | Linux, repo at `/agent/repos/HYDI-System-v2`, `next dev` :3000, `npm run build` OK |
| GitHub + Actions | **Yes** | `clean-main` @ `6d80c587`, open PRs listed below |
| Frank / heidi-pc (Windows) | **No** | Not reachable from this agent; RAM/disk/PM2 audit **blocked** |
| Android / Termux | **No** | No device path; use Termux bundle (see #587) when needed |
| Tailscale to Frank | **No** | Not configured on cloud VM |
| Local Supabase (Docker) | **No** | `npx supabase status` → DB container absent on VM |

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
| GitHub Pages `docs/**` | ✓ | ✓ | ? | ? | ? | Needs `pages: write` + enablement |
| Health Monitor workflow | ✓ | — | — | — | — | #414; secrets often unset in GH |
| `public/client-dashboard.html` | ✓ | — | — | ✓ | ? | **Hardcoded Supabase anon JWT** in static HTML |

## Open PR disposition (2026-11-15)

| PR | Title | Recommendation |
|----|-------|----------------|
| **#586** | `/heidi` dev provenance bundle fix | CI green on `68b086a0`; merge when approved (unblocks cloud dev validation) |
| #532–#537 | Dependabot | Review semver/runtime impact; do not auto-merge |

**Merged recently:** #585 (mobile fabric health disposition truthfulness).

## Prioritized findings

| ID | Severity | Finding | Evidence | Next step |
|----|----------|---------|----------|-----------|
| F-001 | Medium | Supabase **anon** key embedded in `public/client-dashboard.html` | Lines 61–62; JWT payload role `anon` | Move to env-injected server route or remove public page; scan git history (no secret values in reports) |
| F-002 | Low | Health Monitor skips when `SUPABASE_URL` unset | `.github/workflows/health-monitor.yml` L65–67 | Align with #414; Frank `/api/health` as primary monitor per workflow comment |
| F-003 | Medium | PR #586 not on `clean-main` | Open PR; dev `/heidi` 500 without it on pre-fix tree | User merge approval |
| F-004 | High (env) | Frank operational state unknown | No SSH/Tailscale | Read-only Frank probe script (PM2 jlist, ports, disk) with owner approval |
| F-005 | Medium | Mobile E2E not proven on Frank | #586 PR text; cloud only sees pairing UI | `HYDI_SERVICE_SECRET` + device approval on target host |
| F-006 | Info | `CascadeCompleteV2` **does** call full pipeline | `processEvent` → `pipeline.run` | Close “skips ledger” concern for current `clean-main` |
| F-007 | Low | `GET /api/mobile-status` → 401 without auth on VM | `curl` 2026-11-15 | Expected; document for mobile clients |

## Acceptance tests (status)

| Test | Status | Evidence |
|------|--------|----------|
| A Conversation continuity | **NOT RUN** | Needs heidi-core + memory DB on host |
| B Mobile access | **PARTIAL** | Cloud: `/heidi` 200, pairing UI; no paired send/receive |
| C Task execution | **NOT RUN** | Fabric on Frank |
| D Approval enforcement | **NOT RUN** | Hermetic tests exist; live not run |
| E Event pipeline | **NOT RUN** | `tests/unit/pipeline-replay.test.js` not executed this pass |
| F Model resilience | **NOT RUN** | No Ollama on VM |
| G Recovery | **NOT RUN** | |
| H Resource stability | **PARTIAL** | VM only: ~15Gi RAM, disk 6% used |
| I Security | **PARTIAL** | client-dashboard anon key; heidi-mobile-security tests in CI |
| J Deployment integrity | **NOT RUN** | Frank deploy not audited |

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