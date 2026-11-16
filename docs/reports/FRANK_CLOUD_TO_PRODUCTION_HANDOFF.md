# Frank ← Cloud handoff (single checklist)

**Purpose:** Carry cloud agent work (Evolution 2.0, M1 proof labels, assessments) onto **Frank / heidi-pc** without new autonomy features.

**Canonical GitHub PR for this handoff:** [#605](https://github.com/waveformer1984/HYDI-System-v2/pull/605)  
(Supersedes the docs-only [#604](https://github.com/waveformer1984/HYDI-System-v2/pull/604) — close #604 after #605 merges to avoid duplicate docs.)

---

## What is already on `clean-main` (Frank must have at least this)

| Deliverable | PR | On `clean-main`? |
|-------------|-----|------------------|
| Operational supervisor + Frank truth loader | #601 | Yes (merged) |
| Bounded self-improvement loop | #602 | Yes (merged) |
| Evolution 2.0 (history, scoring, regression, dashboard API) | #603 | Yes — baseline **`1a86a7ee`** |

---

## What #605 adds (merge before M1 mission on Frank)

| Change | Why Frank needs it |
|--------|-------------------|
| `lib/heidi/self-improvement/frank-context.js` | `FRANK_VERIFIED` proof only when **LIVE** collector JSON exists |
| `bounded-self-improvement-loop.js` / `heidi-self-improve.js` | Dashboard + missions use that rule (was hardcoded `frank: false`) |
| Assessment + M1 docs | Operator evidence and lint/local-ci notes |
| `scripts/frank-align-clean-main.ps1` | One read-only/safe sync script on Windows |

**Not included:** PM2 restarts, deploy, auto-merge, or autonomous mission `run`.

---

## Recommended merge order (you on GitHub)

1. **Merge [PR #605](https://github.com/waveformer1984/HYDI-System-v2/pull/605)** into `clean-main`.
2. **Close [PR #604](https://github.com/waveformer1984/HYDI-System-v2/pull/604)** (same assessment content is in #605).
3. Wait for GitHub Actions green on `clean-main` (and optionally Frank `local-ci` after pull).

---

## On Frank after merge (canonical tree)

Path: `C:\Users\Owner\HYDI-System-v2` (see `ACTIVE_TREE.md`).

### Option A — one script (preferred)

```powershell
cd C:\Users\Owner\HYDI-System-v2

# 1) Inspect only — no pull
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/frank-align-clean-main.ps1

# 2) After review: pull + collector + M1 checks (still no mission run)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/frank-align-clean-main.ps1 -Pull -Collector -FullM1
```

Artifacts land in `.runtime\acceptance\frank-align-<timestamp>\`.

### Option B — manual (same steps)

```powershell
git fetch origin
git status -sb
git pull origin clean-main
git rev-parse HEAD
powershell -File scripts/frank-production-truth-collect.ps1
npm run runtime:audit
node scripts/heidi-self-improve.js dashboard
$env:ESLINT_USE_FLAT_CONFIG = "true"
node scripts/local-ci.js HEAD
```

### Option C — phone / partial sync (code only)

If you only want the code without full M1:

```powershell
cd C:\Users\Owner\HYDI-System-v2
git fetch origin
git pull origin clean-main
git rev-parse HEAD
npm run runtime:audit
```

PM2 processes keep running old in-memory code until **you** restart the apps you choose — not automated here.

---

## Bounded mission (owner authorization only)

```powershell
node scripts/heidi-self-improve.js run --owner-requested --force-new
```

Run only after:

- Fresh collector file under `.runtime\production-truth\` (LIVE)
- Dashboard shows `verification_environment` reflecting live truth (#605+)
- You explicitly want a mission this session

Expect `proof_label: FRANK_VERIFIED` in `.runtime\self-improvement\missions.jsonl` **only** with #605 merged and live collector — not from cloud tests.

---

## local-ci lint on Frank

If `local-ci/unit-tests` fails on lint but typecheck passes: check **system or PM2** for `ESLINT_USE_FLAT_CONFIG=true`. Child `local-ci` strips it; persistent parent env may still affect other tooling. See `docs/reports/FRANK_OPERATIONAL_VERIFICATION.md`.

---

## Evidence to attach back to cloud agent / chat

From `.runtime\acceptance\frank-align-*\` or M1 folder:

- `summary.json`, `git-head.txt`
- Newest `frank-production-truth-*.json`
- `dashboard.json`, `local-ci.log` exit code
- Last lines of `missions.jsonl` (if mission run)

---

## Related docs

| Doc | Role |
|-----|------|
| `HEIDI_PRODUCTION_TRUTH_AND_INFLECTION_2026-11-16.md` | Strategic assessment |
| `FRANK_M1_PRODUCTION_ACCEPTANCE_2026-11-16.md` | M1 acceptance (BLOCKED until Frank runs) |
| `FRANK_OPERATIONAL_VERIFICATION.md` | local-ci / ESLint env |
| `HEIDI_EVOLUTION_2_FINAL_ACCEPTANCE.md` | Evolution 2.0 status matrix |