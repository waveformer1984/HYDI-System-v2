# Rezonate — Documentation Drift Report

Verified 2026-08-13 by re-reading each document and comparing its claims against direct code inspection and test execution. No documents modified during this phase (corrections applied afterward — see §Remediation Log at the end).

---

## 1. `docs/RESONATE_SYSTEM_RECONCILIATION.md`

| Field | Detail |
|---|---|
| **Claim** | §11 "Phase 4 — Vertical Slice Integration": *"72/72 tests passing in `protoforge-applications/rezonate/`"* |
| **Actual state** | 96 tests, 95 passing, 1 failing (environment artifact) |
| **Evidence** | `node --test tests/*.test.js` run twice this session (once in the prior audit, once in this session), identical result both times: `# tests 96 / # pass 95 / # fail 1` |
| **Required correction** | Update the test count to reflect current reality, and note that the suite has grown by ~24 tests (new files: `local-model-runtime.test.js`, `providers.test.js`, plus growth in existing files) since this doc was last updated. Applied in Phase 11 (see below). |

## 2. `agents/rezonate_node/config.json`

| Field | Detail |
|---|---|
| **Claim** | `"stem_separation": false` |
| **Actual state** | Stem separation is implemented and has produced verified real output (`rezonate/stems/Bad Decision Club/*.wav`) |
| **Evidence** | Direct read of `rezonate/make-stems.py`; real WAV files + `track.json` found on disk |
| **Required correction** | Set `stem_separation: true`. Applied in Phase 11. |
| **Additional drift found (not part of original brief, discovered this session)** | The same manifest also claims `"mixing_mastering": true`, `"nft_minting": true`, `"gig_management": true`, `"beat_academy": true`, `"rights_monetization": true`, `"hardware_control": true` — none of these have corresponding implementation evidence anywhere in the audited tree (mixing/mastering DSP, NFT minting, gig management, and a "beat academy" feature were searched for specifically and not found; hardware_control exists only as the single DDJ-SB3 MIDI mapping, not general hardware control). |
| **Required correction** | The whole capabilities block should be rewritten to reflect verified reality, not just the one field originally flagged. See Phase 11 for the conservative fix applied (marking the block as aspirational pending full capability wiring, rather than guessing at each flag). |

## 3. `docs/PLATFORM_NAMING_GUIDE.md`

| Field | Detail |
|---|---|
| **Claim** | Row for "Resonate": *"Path: `protoforge-applications/rezonate/`, Status: Active, Collisions: None"* |
| **Actual state** | At least 8 physical code locations use the Rezonate/Resonate/Rezonette name (full list in `REZONATE_MODULE_REGISTRY.json`), plus a 9th consumer (`api/chat/route.js handleRezonateMessage`) discovered this session |
| **Evidence** | Filesystem checks this session confirmed all 8 locations still exist, unchanged, alongside the canonical app |
| **Required correction** | Change "Collisions: None" to reference this drift report, or add the still-outstanding locations to the "Retired / reserved names" collision-resolution table the same way `modules/cascade-*.js` etc. are tracked. **Not applied in Phase 11** — this is a governance/architecture-policy statement, not a stale fact-check; correcting it should follow the consolidation decision, not precede it. Left as an open item in `REZONATE_CONSOLIDATION_PLAN.md`. |

## 4. `docs/CANONICAL_PLATFORM_COMPONENTS.md`

| Field | Detail |
|---|---|
| **Claim** | Applications/adapters table: *"Resonate → ExternalAdapter in `protoforge-applications/rezonate/src/events/event-bus.js` → HYDI Event Gateway `POST /events` → Status: **Production**"* |
| **Actual state** | The adapter code and event bus exist and are covered by passing tests (`hydi-gateway.test.js`, part of the 96-test suite). Whether this is genuinely deployed and reachable in a production environment was **not verifiable** from static code inspection or from this sandboxed audit environment. |
| **Evidence** | Read the governance doc directly; ran the local test suite (which exercises the adapter in-process, not against a live Gateway) |
| **Required correction** | Downgrade "Production" to something verifiable, e.g. "Integration tested locally; live deployment status unconfirmed," unless the user can independently confirm a real deployment. **Not applied in Phase 11** (deployment-status claims are outside what documentation-correction authority covers — flagged, not changed). |

## 5. `apps/ursula-frontend/src/components/modules/RezonetteModule.tsx` (self-documenting UI, not a doc file, but makes claims to end users)

| Field | Detail |
|---|---|
| **Claim** | The rendered dashboard displays "Complete" / "Built" status for all 15 listed DAW/AI/blockchain/bot/NFT components, including NFT Minting, NFT Marketplace, Plugin SDK, Mixer & Master, Smart Contracts, and Audio Classification. |
| **Actual state** | The component's own source data (`COMPONENTS` array, lines 64-80) correctly marks 10 of the 15 as `'planned'` and only 4 as `'active'`/`'complete'` — but the render logic (lines 112-116) unconditionally overwrites every item's status to `'complete'` and milestone to `'Built'` before display, regardless of source data. Cross-checked against this and the prior audit: none of NFT minting, smart contracts, plugin SDK, or mixer/mastering exist anywhere in the codebase. |
| **Evidence** | Full file read this session (previously only the first 60 lines had been read). Line numbers cited above are from the file as read. |
| **Required correction** | This is a code bug, not a documentation file, so it's out of scope for "correct documentation" under Phase 11's safe-remediation authority — flagging here and in the consolidation plan as a P0 item, since a user-facing dashboard that claims 100% completion for unbuilt features (including financial/ownership features) is a trust problem, not just a cosmetic one. **Not fixed in Phase 11** (it's a code change, not a doc/config correction, and the instructions explicitly restrict this phase to low-risk doc/config fixes). |

## 5b. `protoforge-applications/rezonate/README.md` (found during Phase 11 remediation pass, not in the original 4 flagged docs)

| Field | Detail |
|---|---|
| **Claim** | §Status: *"Local-first end-to-end ProtoForge application organism. 91/91 tests passing."* |
| **Actual state** | 96 tests, 95 passing (see above) — a **third**, different number from this doc and the reconciliation doc's "72/72." Three documents, three different test counts, none matching the verified 96/95. |
| **Evidence** | Direct read of this README during Phase 11; cross-referenced against the same `node --test` run cited throughout this report. |
| **Required correction** | Update to 96/95. Applied in Phase 11. |
| **Additional correction to prior audit's own characterization** | This README also states: *"Resonate no longer depends on Gemini/Lyria. The default `AudioProvider` is `LocalAudioProvider` backed by `LocalModelRuntime`."* This means the canonical app's default AI generation path is **local-first**, not the Lyria/Gemini path in `rezonate/generate.py` as this report's earlier characterization implied. The standalone `rezonate/generate.py` CLI script still uses Lyria directly, and is still what `heidi-rezonate.js` calls — but the canonical orchestration app has since moved to a pluggable local-model provider by default. This nuance was missed in the initial pass of this session's audit (the `local-model-runtime.js` adapter was marked `UNKNOWN` rather than connected to this README claim) and is corrected here for the record. |

## 6. `docs/RESONATE_EXISTING_SYSTEM_AUDIT.md`

| Field | Detail |
|---|---|
| **Claim** | General accuracy check — this doc's own findings (5+ locations, 31,148 samples, working Python pipeline, mock NFT UI) |
| **Actual state** | Confirmed accurate on every specific, checkable claim re-verified this session (sample count, file paths, working pipeline evidence) |
| **Evidence** | Cross-checked sample count (31,148, exact match), file existence, and capability descriptions |
| **Required correction** | None — this document held up well under re-verification. No action needed. |

## 7. `README.md` (repo root)

| Field | Detail |
|---|---|
| **Claim** | Lists `rezonate` as one of six revenue streams routed through Stripe Connect; does not otherwise describe Rezonate's internal architecture |
| **Actual state** | Accurate as far as it goes — it correctly scopes Rezonate as one revenue stream among six and doesn't overclaim about its internal state |
| **Evidence** | Read in full during the prior audit |
| **Required correction** | None required at the root-README level. The canonical app's own `protoforge-applications/rezonate/README.md` is the more relevant target for an update — see Phase 11. |

---

## Summary Table

| # | Document | Drift Severity | Fixed in Phase 11? |
|---|---|---|---|
| 1 | `docs/RESONATE_SYSTEM_RECONCILIATION.md` (test count) | Medium (stale number) | Yes |
| 2 | `agents/rezonate_node/config.json` (stem_separation) | Medium (inverted fact) | Yes |
| 2b | `agents/rezonate_node/config.json` (other capability flags) | High (broad overclaim) | Partially — see Phase 11 log |
| 3 | `docs/PLATFORM_NAMING_GUIDE.md` ("Collisions: None") | Medium (policy vs. physical reality) | No — deferred to consolidation decision |
| 4 | `docs/CANONICAL_PLATFORM_COMPONENTS.md` ("Production" status) | Medium (unverifiable deployment claim) | No — flagged only |
| 5 | `RezonetteModule.tsx` (render-forces-complete bug) | **High** (user-facing, misrepresents unbuilt NFT/financial features as done) | No — code fix, out of scope for doc remediation |
| 5b | `protoforge-applications/rezonate/README.md` (test count + local-first AI nuance) | Medium (yet another stale count; found during remediation pass itself) | Yes (test count only) |
| 6 | `docs/RESONATE_EXISTING_SYSTEM_AUDIT.md` | None found | N/A |
| 7 | `README.md` (root) | None found | N/A |
