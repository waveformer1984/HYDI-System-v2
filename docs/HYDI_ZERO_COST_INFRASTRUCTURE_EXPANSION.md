# HYDI zero-cost infrastructure expansion

## Resource inventory

| Resource | Role | Classification |
|----------|------|----------------|
| Frank / heidi-pc | Canonical runtime, PM2, Ollama | **BLOCKED** from cloud agent |
| Android / Termux | Mobile ops client | **CONFIGURED BUT UNTESTED** |
| Local Ollama | Inference + embeddings | **VERIFIED SIMULATED** (when running) |
| Cursor cloud agents | This mission | **VERIFIED LIVE** |
| GitHub Actions | CI + proposed worker | **VERIFIED LIVE** (CI); worker **CONFIGURED BUT UNTESTED** |
| Local Supabase Docker | Data plane | **VERIFIED SIMULATED** in CI |
| Tailscale | Private access | **BLOCKED** on agent VM |
| GitHub Pages | Static mobile shell | **CONFIGURED BUT UNTESTED** |

## Free-tier / legitimate credits (research)

| Source | Notes |
|--------|-------|
| OpenAI for Startups community | $0 access to content |
| GitHub Actions | Free tier minutes — monitor billing |
| Supabase local | Self-hosted |
| Vercel | Deploy not primary (local-first) |

**Do not** provision new paid services in this mission.

## Allocation strategy

```text
Priority 1: Frank (when online) — production-shaped workloads
Priority 2: Cursor cloud agents — parallel docs + PR branches
Priority 3: GHA — CI and optional distributed worker
Priority 4: Local VM smoke — simulated classification only
```

## Scheduling rules

- `lib/runtime/collect.js` — avoid parallel PM2 jlist  
- Storage guard — tiers in `lib/storage/disk.js`  
- Memory: prefer remote compute for heavy Jest integration  
- Model match: Ollama default; OpenAI only if operator enables  

## Worker failover

- Distributed lease reclaim (PR #590)  
- Fabric recovery `recoverInterruptedTasks`  
- human operator when daemon stale  

**Classification:** VERIFIED SIMULATED (inventory) + operator-dependent live paths **BLOCKED**