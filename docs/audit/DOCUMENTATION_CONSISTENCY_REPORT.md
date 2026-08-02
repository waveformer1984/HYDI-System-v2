# Documentation Consistency Report

**Date:** 2026-08-02
**Scope:** Every document describing a validation command, plus report templates.

---

## 1. Method

All Markdown in the repository was searched for references to soak, leak, chaos,
failure injection, resilience, operational qualification, security audit,
benchmark, release validation, and production certification. Each claim was
compared against the executable behaviour established in the Validation Tool
Audit Report.

---

## 2. A Correction to the Original Premise

The remediation brief anticipated that `docs/audit/` would contain overstated
claims. **It largely does not.** The phase reports under `docs/audit/` are among
the most honest documents in the repository:

| Document | Claim | Assessment |
|---|---|---|
| `PHASE4_FAILURE_INJECTION.md` | "❌ PENDING — SESSION CONSTRAINT … cannot be executed" | **Accurate** |
| `PHASE2_24H_QUALIFICATION_SOAK.md` | "A 24-hour qualification soak cannot be executed in the current interactive session" | **Accurate** |
| `EXECUTIVE_SUMMARY.md` | "Phase 2 (24-Hour Soak): ❌ NOT EXECUTED" | **Accurate** |
| `OPERATIONAL_QUALIFICATION_REPORT.md` | Phases 2–4 "❌ Not Executed / PENDING (CRITICAL)" | **Accurate** |
| `UPDATED_RISK_REGISTER.md` | Risks 1–3 explicitly named as not executed | **Accurate** |
| `ROLLBACK_CHECKLIST.md` | "❌ NOT VALIDATED — Rollback procedure not executed" | **Accurate** |

These required no correction and were left unmodified.

The inaccurate claims were concentrated in the **root-level release documents**,
which recorded `PASS` for commands that ran something other than what their
names implied.

---

## 3. Corrections Applied

### 3.1 Historical sign-off records — erratum prepended

Per instruction, original text was preserved unaltered and a dated erratum
prepended. `git diff --numstat` confirms **15 insertions, 0 deletions** on each,
so the audit trail is intact.

| Document | Inaccurate claim |
|---|---|
| `RC2_GO_NO_GO_REPORT.md` | `npm run soak-test` \| PASS |
| `RC3_GO_NO_GO_REPORT.md` | `npm run soak-test` \| PASS |
| `FINAL_RELEASE_DECISION.md` | `npm run soak-test` \| PASS |
| `RELEASE_READINESS_AUDIT.md` | `npm run soak-test` \| PASS \| 2/2 |
| `RELEASE_REPORT_v0.9.0.md` | Soak test \| `npm run soak-test` \| PASS (short-cycle) |

The erratum states what each command actually executed and reclassifies both
entries as **VERIFIED (unit test only)**, noting that endurance and
resource-leak behaviour were **NOT TESTED** as of those reports.

`RELEASE_REPORT_v0.9.0.md` deserves note: it qualified its entry as
"PASS (short-cycle)", which was closer to honest than the others — but still
implied the soak script had run briefly, when in fact a Jest unit test ran.

### 3.2 Forward-looking documents — corrected in place

| Document | Was | Now |
|---|---|---|
| `STABILITY_ROADMAP.md` L169-171 | "`npm run soak-test` # Full 24-hour test" | Correct command names, plus a scope note that the default run evidences no recovery |
| `STABILITY_ROADMAP.md` L228-231 | "Auto-recovery ✅ `npm run soak-test:1h`" | "Not tested by endurance runs" → points at `soak-test-24h:chaos` |
| `STABILITY_ROADMAP.md` L229 | "Memory leak detection ✅" | "Harness process only", with the 10-minute window caveat |
| `STABILITY_ROADMAP.md` L342, 374, 386, 418 | `soak-test:1h` / `soak-test` | Renamed commands |
| `RELEASE_CHECKLIST.md` L24-25 | "`npm run soak-test` passes" | Split into unit-test gates and a separate **Operational Evidence** section for long-running runs |
| `PHASE44_...ARCHITECTURE.md` L141 | `npm run leak-test` | `npm run resource-leak-test` |
| `CLAUDE.md` L44 | V3 command list only | Added an *Operational validation* block annotating scope of each command |
| `operational-qualification/README.md` | Described a working harness with failure injection | Chaos-disabled-by-default banner, a dated correction recording the four defects, classification legend, and an explicit "What a PASS never covers" section |
| `tests/soak-test-24h.js` | Documented `--duration-hours`, never implemented | Corrected to `TEST_DURATION`; marked superseded by `scripts/soak-test.js` |

### 3.3 Report templates

`operational-qualification/reports/report-generator.js` now emits a
`classificationLegend` and a `scopeStatement` in every report. Each acceptance
criterion carries `status`, `classification`, and `evidence`. A run without
`--chaos` produces `summary.status: "pass_with_gaps"` — never a clean `pass` —
and lists every untested area by name.

---

## 4. Ambiguous Claims — Annotated, Not Rewritten

Several documents say "Soak testing: 100% pass rate" or "Chaos tests: ✅ PASS"
where the underlying evidence is Jest unit tests. These statements are literally
true — those tests do pass — but conflate unit-test coverage with operational
validation.

| Document | Statement | Disposition |
|---|---|---|
| `PRODUCTION_READINESS_REPORT.md` L71 | "Soak testing: 100% test pass rate" | Left; superseded by this report and the audit report |
| `PHASE3_RELIABILITY_ENGINEERING_REPORT.md` L10, 190, 202 | "soak testing … all pass successfully" | Left; refers to 2 unit tests |
| `FINAL_VALIDATION_REPORT.md` L64 | "Chaos tests ✅ PASS" | Left; refers to Jest integration tests |
| `PHASE6_PRODUCTION_READINESS_REVIEW.md` L63 | "Chaos tests ✅ PASS" | Left |
| `PHASE2_24H_OPERATIONAL_SOAK.md` L40-50 | "Soak test framework has been validated" | Left — correctly describes *framework* validation |

**Rationale:** these are dated phase reports, not live guidance. Rewriting them
would alter the historical record for a defect of emphasis rather than fact. The
authoritative correction now lives in this report and in
`VALIDATION_TOOL_AUDIT_REPORT.md`. `PHASE2_24H_OPERATIONAL_SOAK.md` in
particular is precise — it says the *framework* was validated, which is exactly
what happened.

---

## 5. Documentation ↔ Implementation Synchronisation

Documentation drift is now partly enforced by tests rather than review.
`tests/unit/validation-tooling-integrity.test.js` fails the build if:

- any `package.json` script key is duplicated
- `soak-test` or `leak-test` are reintroduced
- a named command stops invoking the script its name implies
- any script references a file that does not exist on disk
- an endurance command is aliased to a Jest run
- the soak header loses its VERIFIED / NOT VERIFIED scope sections
- `simulateNetworkBlip` or the string "Injecting network blip" returns
- chaos becomes enabled by default

This does not cover prose. Claims in Markdown about *results* still require
human review — the tests can only guarantee that commands do what their names
say.

---

## 6. Residual Inconsistencies

| Item | Classification | Note |
|---|---|---|
| Four soak implementations coexist | **OBSERVED** | Each now documents its own scope; not consolidated |
| `reports/business-os/phase27b-operational-certification.md` L484 notes the legacy/V3 soak split | **Accurate** | Already truthful; no change |
| Prose claims of "100% pass" referring to unit tests | **OBSERVED** | Annotated in §4, left in place |
| No CI job runs any operational validation | **VERIFIED** | Accurate in docs; unchanged |
