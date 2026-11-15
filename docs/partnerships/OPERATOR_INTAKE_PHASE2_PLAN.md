# Phase 2 — operator-triggered intake (bounded)

**Prerequisite:** PR #593 merged only after owner questionnaire + review sign-off.  
**Out of scope:** scraping, cron, auto-submit, account creation, credential changes, automatic integration.

## Single-program pilot flow

1. **Official source** — operator supplies one URL *or* one PDF/Markdown export saved outside the repo.
2. **Dated evidence** — `recordOperatorSourceVerification` with `source_checked_at`, optional content hash, operator auth.
3. **Eligibility** — run against `HYDI_ORG_PROFILE_PATH` approved facts only; surface `missing_facts`.
4. **Ranking** — explain `priority_score` / `priority_reasons` in mobile snapshot (already deterministic).
5. **Draft** — `awaiting_approval` only when profile + source verified; never external send.

## Pilot candidate (suggested)

**OpenAI for Startups — VC referral path** (`tests/fixtures/partnerships/openai-for-startups-vc-api-credits.json` as shape only).

Operator steps:

1. Open https://openai.com/business/why-openai/startups/ and confirm current benefits text.
2. Paste excerpt + check date into verification evidence (or attach exported page under operator storage).
3. Complete questionnaire §3 (VC status) and §6 (API credits priority).
4. Run one-shot CLI (no scheduler): `node scripts/resource-acquisition-pass.js` with `HYDI_ORG_PROFILE_PATH` set.

## Page retrieval

- **If** Cursor/Frank can fetch the URL read-only: store excerpt + hash in verification evidence.
- **If not:** operator-provided document is source of truth; mark limitations in `source_verification_note`.

## Reuse

- Existing partnership coordinator + `ResourceAcquisitionEngine` (no new agent).
- Optional: link to research docs on master-mission branch (`OPENAI_RESOURCE_OPPORTUNITIES.md`) as human-readable context only — not auto-imported as verified data.