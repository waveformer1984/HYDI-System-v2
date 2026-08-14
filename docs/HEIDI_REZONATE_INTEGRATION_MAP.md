# Heidi ↔ Rezonate Operational Integration Map

Date: 2026-08-14
Scope: local-only; cloud Supabase is not a dependency.

## 1. Authority Levels

| Level | What Heidi may do | Examples |
|---|---|---|
| **OBSERVE** (READ) | Read health, list projects/tracks/assets/jobs, report capability state, report failures | `GET /health`, `GET /projects`, `GET /projects/:id/tracks`, `GET /processing/jobs/:id` |
| **OPERATE** (LOW/MEDIUM, `rezonate:manage`) | Invoke real, verified canonical operations: create project/track, register asset, create/start processing job, export package | `POST /projects`, `POST /projects/:id/tracks`, `POST /processing/jobs`, `POST /projects/:id/export` |
| **AUTONOMOUS EXECUTION** | **NOT enabled in this phase.** Any delete, publish, ownership change, spend, external account, external communication, production deploy, or security credential change remains human-authorized. | Delete, publish, release, transfer rights, NFT minting, marketplace, production deploy, credential rotation |

The existing `lib/auth/requireAuth.js` + `lib/auth/rbac.js` `rezonate:manage` permission is the canonical authorization owner. No second approval mechanism is invented.

## 2. Canonical Path (source of truth)

| Layer | Canonical | Notes |
|---|---|---|
| Frontend | `apps/ursula-frontend` (`RezonetteModule.tsx`) | Capability-contract-backed dashboard |
| API | `protoforge-applications/rezonate/src/api/router.js` | Local Express API, auth on by default |
| Persistence | `protoforge-applications/rezonate/src/persistence/` | Memory/JSON default; Supabase opt-in only |
| Repository | `protoforge-applications/rezonate/src/repository.js` | Domain operations and event emission |

## 3. Capability Inventory from `capability-contract.json`

### FUNCTIONAL / VERIFIED / PRODUCTION — safe for Heidi to invoke or describe as working

| Capability ID | State | Canonical API / Module | Heidi Surface | Notes |
|---|---|---|---|---|
| `stem_separation` | VERIFIED | `rezonate/make-stems.py` via `ResonateEngineAdapter` | `POST /processing/jobs` + `POST /processing/jobs/:id/start` | Real WAV output verified on disk |
| `ai_song_generation` | FUNCTIONAL | `rezonate/generate.py` via `ResonateEngineAdapter` | same as above | Requires `GEMINI_API_KEY` (not available locally; state stays FUNCTIONAL) |
| `sample_management` | VERIFIED | `protoforge-applications/rezonate/src/adapters/sample-library.js` | `GET /assets`, `GET /projects/:id/assets` | 31,148 catalog entries |
| `metadata_extraction` | VERIFIED | `rezonate/make-stems.py` / `rezonate/scan-samples.js` | `GET /assets/:id` | track.json verified |
| `bpm_detection` | FUNCTIONAL | `rezonate/make-stems.py` | `POST /processing/jobs` (type `analyze`) | librosa-based |
| `key_detection` | FUNCTIONAL | `rezonate/make-stems.py` | same as above | Krumhansl-Schmuckler |
| `daw_export` | VERIFIED | `protoforge-applications/rezonate/src/export/packaging.js` | `POST /projects/:id/export` | Passing export tests |
| `midi_note_mapping` | VERIFIED | `components/song-composer/MidiControllerInterface.ts` | Not yet wired to Heidi task router; read-only status possible | DDJ-SB3 mapping |
| `midi_ddj_sb3` | FUNCTIONAL | same as above | Not yet wired | Hardware profile |
| `studio_project_management` | VERIFIED | `protoforge-applications/rezonate/src/domain/processing-job.js`, `src/repository.js` | `GET /projects`, `POST /projects`, `GET /projects/:id/tracks`, `POST /projects/:id/tracks`, `POST /processing/jobs` | Tested CRUD |

### PARTIAL / SCAFFOLD / PLANNED — Heidi must not claim these work or attempt to invoke

| Capability ID | State | Module | Why not operable |
|---|---|---|---|
| `waveform_generation` | PARTIAL | `components/song-composer/WaveformSpectrum.tsx` | UI scaffold only |
| `audio_playback` | PARTIAL | `src/api/router.js (GET /assets/:id/file)` | Stream path not independently re-verified |
| `audio_analysis` | PARTIAL | `rezonate/make-stems.py` | BPM/key only, no spectral/transient |
| `midi_routing` | PARTIAL | `MidiControllerInterface.ts` | Note On only, no CC/pitch-bend/etc. |
| `midi_external_hardware` | PARTIAL | `MidiControllerInterface.ts` | Only DDJ-SB3 mapped |
| `midi_sequencer` | PLANNED | none | No implementation |
| `studio_song_composer` | PARTIAL | `pages/song-composer.tsx` | Produces LLM JSON, no audio |
| `studio_sample_browser` | PARTIAL | `SampleLibrary.tsx` + `sample-library.js` | Backend verified, UI not |
| `studio_session_management` | SCAFFOLD | `supabase/functions/rezonate-engine/index.ts` | Stub handler |
| `studio_visualization` | PARTIAL | `WaveformSpectrum.tsx` | Stub preview |
| `studio_recording` | PARTIAL | `RezonateDAWModule.tsx` | MediaRecorder, not re-verified |
| `studio_mixing` | PLANNED | none | No DSP code |
| `marketplace_nft` | PLANNED | none | 0% implemented |
| `marketplace_listing` | PLANNED | none | 0% implemented |
| `marketplace_royalty` | PLANNED | none | 0% implemented |
| `blockchain_wallet` | PLANNED | none | 0% implemented |
| `audio_classification` | PLANNED | none | 0% implemented |

### Ownership / rights — tested models, no write without human approval

| Capability ID | State | Module | Heidi policy |
|---|---|---|---|
| `ownership_registry` | FUNCTIONAL | `src/domain/ownership-record.js` | Read allowed; write requires human approval |
| `rights_registry` | FUNCTIONAL | `src/domain/rights.js` | Read allowed; write requires human approval |

## 4. Heidi Task Routing Matrix (added)

| Task Type | Routed To | Canonical API / Repository Call | Risk |
|---|---|---|---|
| `REZONATE_LIST_PROJECTS` | `rezonate.agent` | `repository.listProjects()` | READ |
| `REZONATE_CREATE_PROJECT` | `rezonate.agent` | `repository.createProject(payload)` | OPERATE |
| `REZONATE_LIST_TRACKS` | `rezonate.agent` | `repository.listTracks(projectId)` | READ |
| `REZONATE_CREATE_TRACK` | `rezonate.agent` | `repository.createTrack(projectId, payload)` | OPERATE |
| `REZONATE_GET_JOB` | `rezonate.agent` | `repository.getProcessingJob(id)` | READ |
| `REZONATE_CREATE_JOB` | `rezonate.agent` | `repository.createProcessingJob(...)` | OPERATE |
| `REZONATE_START_JOB` | `rezonate.agent` | `repository.startProcessingJob(id)` | OPERATE (human-approval for destructive/high) |
| `REZONATE_EXPORT_PROJECT` | `rezonate.agent` | `repository.getProject` + `packageStems` | OPERATE |
| `REZONATE_HEALTH` | `rezonate.agent` | `collectDiagnostics(repository)` | READ |

All OPERATE tasks require `rezonate:manage` per `lib/auth/rbac.js`. Autonomous execution for deletes, publishes, ownership changes, spend, external accounts, external comms, production deploys, and credential changes is **not enabled**.

## 5. Data Access Rule

Heidi never queries `rezonate_projects`, `rezonate_tracks`, or any Supabase table directly. It routes through `protoforge-applications/rezonate/src/repository.js` or the canonical API. This removes `handleRezonateMessage` from the four fragmented data-access surfaces.

## 6. Failure Behavior

- If the canonical API is unavailable: report `UNAVAILABLE`, do not fabricate, do not fall back to cloud Supabase.
- If a capability is `PARTIAL`/`SCAFFOLD`/`PLANNED`: Heidi states it is not yet operational and does not invoke it.
- If auth fails: return explicit `403`/`rezonate:manage required`.
- All operations emit an audit event via the repository's `EventBus`.

## 7. Remaining Gaps

- Real health wiring to `api/ursula/status.js` or `api/health.js` is not yet end-to-end tested against a running canonical API.
- `api/chat/route.js handleRezonateMessage` now uses the repository, and persistence is canonical local JSON.
- No read-only `rezonate:view` permission exists yet; `viewer` cannot list Rezonate state through the auth layer.

## 8. Control-Plane Hardening (Phase 3)

### Intent normalization

`lib/rezonate/intent.js` is now an explicit, regex-based normalizer that:
- Only returns `ok: true` for the five verified operations.
- Validates required parameters (`name`, `id`, `projectId`) and returns `malformed: ...` for empty/missing values.
- Classifies unsupported/forbidden intents (`GET_TRACK`, `UPDATE_PROJECT`, `NFT`, `MARKETPLACE`, `MASTERING`, `delete`) before execution.
- Does not call the repository, Supabase, or any cloud API.

### Failure safety

`HeidiController.processUserEvent` checks, in order:
1. `hasPermission(role, 'rezonate:manage')` for every `REZONATE_` task.
2. `capabilityGuard.getTaskCapabilityState(type)`; non-`VERIFIED` tasks are rejected before routing.
3. Idempotency guard for mutations; exact duplicate requests within 5 seconds are rejected.
4. `RezonateAgent` validates parameters and emits `REZONATE_TASK_FAILED` on repository errors; `HeidiController` records `HEIDI_AGENT_FAILURE` and returns `{ ok: false, reason }`.

### Audit events

Every verified operation produces records for `HEIDI_USER_EVENT_RECEIVED`, `HEIDI_AGENT_SUCCESS`/`HEIDI_AGENT_FAILURE`, and `REZONATE_TASK_COMPLETED`/`REZONATE_TASK_FAILED`. `AuditLog` now auto-timestamps records and redacts `secret`, `key`, `token`, `password` fields.

### Health surface

`lib/rezonate/control-health.js` reports six independent layers:
`HEIDI_CONTROLLER`, `TASK_ROUTER`, `REZONATE_AGENT`, `REZONATE_CLIENT`, `LOCAL_PERSISTENCE`, `EVENT_BUS`. The top-level `ok` is `true` only when every layer is available.

### Idempotency

The canonical repository has no built-in idempotency key; `createProject` and `createTrack` will create duplicates if called directly. Heidi prevents exact duplicate (same type + same parameters) within a 5-second window at the controller layer.

### Verified test coverage

| Suite | Tests | Result |
|---|---|---|
| `tests/unit/heidi-control-plane-acceptance.test.js` | 35 | PASS |
| `tests/unit/heidi-rezonate-acceptance.test.js` | 8 | PASS |
| `tests/unit/chat-route-rezonate.test.js` | 7 | PASS |
| `tests/unit/persistence-guard.test.js` | 8 | PASS |
| `npm run typecheck` | — | PASS |
| `npm run build` | — | PASS (with pre-existing ESLint warnings) |
| `npm run validate:rezonate-contract` | 44/1/2 | PASS |
| `node --test protoforge-applications/rezonate/tests/*.test.js` | 128 | PASS |

The full `npm test` suite has 7 unrelated pre-existing failures (Git WSL ownership, Proto YI reachability, hardware detection, goal-executor assertion, V3 heartbeat/compute). These are unchanged by the control-plane hardening.
