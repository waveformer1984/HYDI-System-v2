# Resource inventory — verified vs unverified

**Audit date:** 2026-11-15 (Cursor cloud agent VM)  
**Mode:** No accounts provisioned; no secrets reproduced.

| Resource | Ownership | Service status (this run) | Quota / cost | Integration |
|----------|-----------|---------------------------|--------------|-------------|
| **GitHub repo** | `waveformer1984/HYDI-System-v2` | Accessible (push CI runs) | Actions minutes — **UNVERIFIED** (check Settings → Billing) | Branches, PRs, `unit-tests.yml`, `deploy-pages.yml`, manual `deploy-cloudflare.yml` |
| **GitHub Pages** | Same repo | Workflow present; live enablement **UNVERIFIED** | Static hosting, no GPU | `docs/index.html` mobile shell |
| **GitHub Actions Cloudflare deploy** | Manual dispatch only | **UNVERIFIED** run | Skips deploy if secrets missing (exits 0) | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` required |
| **Supabase cloud** | Project ref in docs | **Not used** in critical path (local-first) | Was suspended historically per CLAUDE.md | Edge functions exist; agent uses local Docker when started |
| **Supabase local (Docker)** | Dev/agent | **Not running** unless `cloud-agent-start.sh` succeeds | Free (self-hosted) | Unit DB suites |
| **Vercel** | Archived / unused | Not linked per CLAUDE.md | N/A | Legacy archived config |
| **Cloudflare Workers** | Optional Ursula app | **UNVERIFIED** | Free tier limits — check dashboard | `apps/ursula-frontend` `deploy:cf` |
| **Render** | — | **No repo integration found** | N/A | — |
| **Tailscale** | User tailnet | **UNAVAILABLE** on this VM without `TS_AUTHKEY` | Free tier personal | `docs/TAILSCALE.md`, MCP :8470 |
| **Frank / Windows home** | Operator machine | **UNREACHABLE** from cloud agent | Local electricity only | PM2, Ollama, hydi-schedulers |
| **Android / Termux** | Operator device | **Not attached** to this run | N/A | GitHub Pages + pairing BFF |
| **Ollama** | Self-hosted | **Not running** on agent VM | $0 | `ENABLE_LOCAL_MODEL`, local-first router |
| **Cursor cloud agent** | This VM | **Running** | Included in Cursor product | File-backed control plane demo |

## Zero-cost enforcement (implemented)

- `config/distributed-cloud.json` → `maxPaidUsdPerDay: 0`, `zeroCostMode: true`
- Reuses `HYDI_ALLOW_PAID_LLM` gate for paid model spend
- Hourly task cap with safe reject (`HOURLY_TASK_CAP`)
- No automatic provider upgrades in code paths added by this PR