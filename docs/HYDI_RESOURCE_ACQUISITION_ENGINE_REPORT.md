# HYDI Master Mission — Autonomous Resource Acquisition Engine Report

**Generated:** 2026-11-15  
**Branch:** `Cusor_agent01resource-acquisition-master-7718` (extends partnerships / PR #593)  
**Related PRs:** [#593](https://github.com/waveformer1984/HYDI-System-v2/pull/593) (partnerships — **unmerged**), [#591](https://github.com/waveformer1984/HYDI-System-v2/pull/591) (OpenAI master mission docs)

---

## 1. Architecture audit — implementation gap matrix

| Capability | Partnerships `ec7e6c38` | OpenAI mission `ec53ebaa` | Master branch (this work) | Classification |
|------------|-------------------------|---------------------------|---------------------------|----------------|
| Opportunity store + dedupe | Yes | — | Extended schema (`opportunity-schema.js`) | **COMPLETE** (simulated) |
| Fixture examples (4 programs) | Yes | — | Retained + 48 curated seeds | **COMPLETE** (unverified seeds) |
| OpenAI research table | — | `OPENAI_RESOURCE_OPPORTUNITIES.md` | Mirrored in `seeds/ai-developer.json` | **PARTIAL** (doc not on this branch; seeds on branch) |
| Qualify / eligibility | Yes | — | Reused coordinator | **COMPLETE** |
| Rank / prioritize | Yes | — | `intelligence.js` multi-bucket | **COMPLETE** |
| Application drafts | Yes | — | + `application-kit.js` | **COMPLETE** |
| Operator auth (submit/award) | Yes | — | Reused | **COMPLETE** |
| Mobile snapshot | Yes | — | + `dashboard` sections | **COMPLETE** |
| Discovery (live web) | No | Research only | Curated seeds + optional HTTP reachability | **PARTIAL** |
| Continuous PM2 scheduler | No | No | CLI `resource-discovery-cycle.js` only | **PARTIAL** (on-demand) |
| Execution fabric typed actions | No | Dev workforce | `resource.*` action runner | **COMPLETE** (in-process) |
| CapabilityRegistry wire-up | No | — | `capability-bindings.js` descriptors | **PARTIAL** (not registered in TS registry) |
| Frank / Tailscale activation | No | — | Handoff commands only | **BLOCKED** |
| Human org profile | Template only | — | `HYDI_ORG_PROFILE_PATH` | **BLOCKED** (owner file) |
| PR #590 distributed hardening | — | References | Not merged | **BLOCKED** |

**Reused (not duplicated):** `lib/partnerships-funding/*`, Heidi mobile `guard`, mission worker lifecycle pattern (conceptual), existing revenue / Stripe modules for commercial category reference.

---

## 2. Implemented functionality (this branch)

- **`lib/resource-acquisition/`** — discovery engine, 48 official-url seeds (12×4 categories), intelligence buckets, application kit, typed actions, dashboard builder, system facade, live HTTP reachability (no benefit parsing).
- **`scripts/resource-discovery-cycle.js`** — daily/weekly/monthly **on-demand** cycles (no new daemon).
- **Mobile** — `pages/api/heidi-mobile/partnerships.js` serves `dashboardSnapshot()` (overview, value, action center, tracking).
- **Tests** — unit + integration (`resource-acquisition-fabric.test.js`).

---

## 3. Live discovery results (controlled)

**Command (cloud VM):** `HYDI_ALLOW_LIVE_DISCOVERY=1` + `runLiveReachabilityCheck` on 4 URLs.

| Metric | Result |
|--------|--------|
| Curated seeds ingested | **48** (12 per category) |
| Benefit/eligibility verified live | **0** (by design until operator verifies) |
| HTTP reachability sample | 4 URLs; statuses 200/403/429 — **reachability only** |

Categories meet **discovery target of ≥10 leads each** as **curated official URLs**, not confirmed funding.

---

## 4. Test results

```bash
npx jest tests/unit/partnerships-funding.test.js tests/unit/partnerships-acquisition-guards.test.js \
  tests/unit/resource-acquisition-discovery.test.js tests/unit/resource-acquisition-actions.test.js \
  tests/unit/resource-acquisition-engine.test.js --runInBand

npx jest tests/integration/resource-acquisition-fabric.test.js --testMatch="**/*.test.js" --runInBand
```

**Result:** 25+ tests passing on this branch (integration run explicitly — excluded from default `npm test` match).

---

## 5. Acceptance criteria checklist

| Criterion | Status |
|-----------|--------|
| Architecture audited | **COMPLETE** |
| Opportunity schema | **COMPLETE** |
| Discovery engine operational | **PARTIAL** (curated + optional HTTP; no scraper) |
| Multiple provider adapters | **PARTIAL** (seed files, not live adapters) |
| Deduplication verified | **COMPLETE** |
| Qualification engine | **COMPLETE** |
| Ranking engine | **COMPLETE** |
| Application preparation | **COMPLETE** |
| Human approval enforced | **COMPLETE** |
| Partnerships coordinator integrated | **COMPLETE** |
| Execution fabric integrated | **PARTIAL** (JS actions; TS registry not wired) |
| Resource dashboard | **COMPLETE** (mobile API) |
| Application tracking | **COMPLETE** |
| Scheduling operational | **PARTIAL** (CLI only) |
| Security tests | **COMPLETE** (guards suite) |
| Integration tests | **COMPLETE** (1 fabric suite) |
| Live discovery executed | **PARTIAL** (reachability only) |
| Failure recovery verified | **PARTIAL** (dedupe/idempotent draft; no DB) |
| Documentation | **COMPLETE** (this report + prior docs) |
| Pull requests | **PARTIAL** (#593 open; this branch pending PR) |
| Final operational report | **COMPLETE** (this file) |

---

## 6. Security findings

- Submit/award require operator authorization **and** evidence references.
- Unverified seeds capped in priority; `application_ready` false until operator verifies source.
- No secrets in mobile dashboard; profile fields not exposed.
- Live fetch does not bypass 403/429 — does not treat HTTP success as award.
- **Gap:** Production HTTP API for operator writes not exposed (CLI/in-process only).

---

## 7. Operational activation (Frank / Windows) — **not executed**

```powershell
# Private approved profile (never commit)
$env:HYDI_ORG_PROFILE_PATH = "C:\path\outside\repo\hydi-org-profile.json"
$env:HYDI_PARTNERSHIPS_OPERATOR_SECRET = "<matches HYDI_SERVICE_SECRET or dedicated secret>"

# On-demand weekly discovery (no PM2 loop unless operator adds scheduled task)
cd C:\Users\Owner\HYDI-System-v2
node scripts/resource-discovery-cycle.js weekly

# Optional reachability audit (not benefit verification)
$env:HYDI_ALLOW_LIVE_DISCOVERY = "1"
$env:HYDI_LIVE_DISCOVERY_MAX_URLS = "8"
node scripts/resource-discovery-cycle.js weekly
```

**Mobile verify (Tailscale / paired device):** `GET /api/heidi-mobile/partnerships` — expect `dashboard.resource_overview` and `fixture_backed: true` until live verification workflow runs.

**Blocked without owner:** approved profile file, Frank deploy, operator secret on mobile host, merge of #593.

---

## 8. Commits and branches

| Item | Value |
|------|--------|
| Partnerships base | `ec7e6c38` |
| OpenAI research docs | `ec53ebaa` on `Cusor_agent01openai-master-mission-7718` |
| Master mission branch | `Cusor_agent01resource-acquisition-master-7718` |

*(Commit hash for this implementation: written at push time.)*

---

## 9. Cost posture

- **No new always-on agents** or paid infrastructure for this module.
- **Not** zero marginal cost for all of HYDI (CI, compute, existing services unchanged).
- Default remains **$0 paid LLM** (`HYDI_ALLOW_PAID_LLM` off) unless owner enables.

---

## 10. Remaining blockers

1. Owner questionnaire + private `HYDI_ORG_PROFILE_PATH`.
2. Merge policy for #593 / master branch PR (human review).
3. Wire `RESOURCE_CAPABILITIES` into `lib/heidi/CapabilityRegistry.ts` if Heidi cognitive loop should invoke `resource.*` directly.
4. Frank/Tailscale validation of mobile BFF.
5. Operator-approved recurring schedule (if desired) — use existing PM2 **only** after explicit ops approval (not auto-added).