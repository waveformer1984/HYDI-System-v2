# One real opportunity — operator runbook

Goal: one program with official source, operator-verified terms, approved org facts, eligibility decision, draft awaiting owner review. **No external submit.**

## 1. Private profile

Create JSON outside the repo. Set `HYDI_ORG_PROFILE_PATH`. Required:

- `approved_by_owner: true`
- `owner_approval_record.approved_by`, `approved_at`
- Sections: `legal`, `classification`, `sharing`
- Facts for eligibility (e.g. `funding.vc_backed` for OpenAI VC path)

See minimum fields in `OWNER_PROFILE_QUESTIONNAIRE.md`.

## 2. Discover locally

```bash
node scripts/resource-discovery-cycle.js weekly
# or load fixture / intake for a known id
```

## 3. Operator verify source + terms (human)

In a browser, confirm the **official URL** and published benefit/restriction language. Then:

```bash
export HYDI_PARTNERSHIPS_OPERATOR_SECRET='…'
export OPERATOR_TOKEN="$HYDI_PARTNERSHIPS_OPERATOR_SECRET"
node scripts/partnerships-operator-verify.js <opportunityId> --terms --application-open=unknown
```

This sets `operator_verified` and `published_benefits_verified` — **not** an award.

## 4. Qualify and prepare

```bash
node scripts/resource-acquisition-pass.js   # or Heidi resource.* capabilities
```

`prepareDraft` requires: approved profile + operator-verified source + **published_benefits_verified** + eligibility pass.

## 5. Owner review

Pipeline should reach `awaiting_approval` with `application_draft`. Owner approves via existing mission/chat paths — **not** via operator token alone.

## 6. Submit / award (later, separate)

`record_submission` / `record_award` need operator secret + evidence references. Never automated.