# Proto YI / Proto.I.Y System Reconciliation Audit

## Executive summary

Phase 7.5b audited every Proto YI / Proto.I.Y implementation in and around the HYDI ecosystem. The canonical ownership is now established:

- **Canonical ProtoForge application identity:** `protoforge-applications/proto-yi/`
- **Legacy domain engine (source of truth for projects & timelines):** `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\proto_iy.py` (Flask / SQLite)
- **Legacy Next.js presentation UI:** `apps/ursula-frontend/src/app/protoi/` and `src/lib/protoi/`
- **Unrelated procedural-memory seed concept:** `heidi-core/seed-procedural-memory.js` and `supabase/migrations/20260626140000_seed_procedural_memory.sql` (AI design generation, not project management)
- **UI inventory stub:** `apps/ursula-frontend/src/components/modules/InventoryModule.tsx` `protoyi-rcws` (no filesystem implementation)

No application logic was created or modified in this phase. Only documentation was updated. The existing Flask engine and the Next.js `protoi` UI remain untouched.

## Method

Searched the repository and the `C:\ProtoForge_Ecosystem\Ursula_Suite\` companion codebase for:

```text
proto-yi
proto_yi
proto iy
proto.i.y
ProtoYI
Proto YI
Proto.I.Y
protoyi
project management
timeline
milestone
task management
project wizard
```

Inspected code, filenames, exports/imports, route handlers, Flask blueprints, SQLite schemas, READMEs, architecture docs, comments, TODOs, frontend components, Supabase migrations, procedural-memory seeds, and test suites.

---

## 1. Existing systems inventory

### 1.1 Flask Proto.I.Y engine (Ursula EPM Suite) — legacy domain source of truth

| Field | Value |
|-------|-------|
| Path | `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\proto_iy.py` |
| Project Name | Proto.I.Y ("Project Infrastructure & Yield") |
| Technology | Python 3, Flask, SQLite3 |
| Status | Active local Flask engine; real domain engine |
| Capabilities | Project creation (`create_project`), timeline generation from milestones (`create_timeline`), project timeline retrieval (`get_project_timeline`) |
| APIs (via `api/ursula_server.py`) | `POST /proto_iy/project`, `POST /proto_iy/timeline` |
| Storage | SQLite; tables `projects` and `timelines` in `ursula_epm.db` |
| Tests | `C:\ProtoForge_Ecosystem\Ursula_Suite\tests\test_proto_iy.py` — 32 tests |
| HYDI behavior | `test_hydi_analysis_data_structure` and `test_hydi_receives_project_data` confirm the engine serializes project/timeline data for HYDI consumption |
| Dependencies | `sqlite3`, `datetime` (stdlib) |
| Owner/Source | `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\proto_iy.py` |

Domain model:

- **Projects:** `id`, `name`, `category`, `owner_id`, `status` (`planning`), `created_at`.
- **Timelines (milestones):** `id`, `project_id`, `milestone`, `start_date`, `end_date`, `duration_hours`.

Notes:

- This is the only implementation that actually persists project and timeline data to a durable store (SQLite).
- It does not emit events to the HYDI Event Gateway today.
- It is a local companion server (`http://localhost:5000`) and is not deployed inside the HYDI Vercel runtime.

### 1.2 Ursula `ursula_server.py` routes for Proto.I.Y

| Field | Value |
|-------|-------|
| Path | `C:\ProtoForge_Ecosystem\Ursula_Suite\api\ursula_server.py` |
| Technology | Flask |
| Proto.I.Y routes | `POST /proto_iy/project`, `POST /proto_iy/timeline` |
| Integration | Imports `ProtoIY` from `apps/proto_iy`; uses shared `DB_PATH` (`ursula_epm.db`) |
| Dashboard | `/dashboard/index` renders `dashboard/index.html`; `/dashboard/health` polls all 5 apps including `proto_iy` |
| Health endpoint | `GET /health` returns `ursula-epm-online` and lists `proto_iy` as an active app |

### 1.3 Dashboard integration

| Field | Value |
|-------|-------|
| Path | `C:\ProtoForge_Ecosystem\Ursula_Suite\dashboard\routes.py` |
| Proto.I.Y entry | `APP_ENDPOINTS['proto_iy']` with `url: 'http://localhost:5001/health'`, `name: 'Proto-IY'`, `description: 'Text-to-design AI generation'` |
| Pipeline stages | 9-stage ProtoForge pipeline is defined in this file and used by the dashboard (Concept → Archival) |
| Behavior | Background thread polls `proto_iy` health every 5 seconds; logs activity transitions |

Note: the dashboard description says "Text-to-design AI generation," which conflicts with the `Projects & Timelines` description in `CLAUDE.md`. This is a labeling drift that should be corrected when the adapter is built.

### 1.4 Next.js `protoi` UI (HYDI repo)

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/src/lib/protoi/`, `apps/ursula-frontend/src/app/protoi/`, `apps/ursula-frontend/src/app/api/protoi/` |
| Project Name | Proto.I.Y / "PROJECT WIZARD" |
| Technology | TypeScript, Next.js App Router, React, Tailwind |
| Status | Active UI with local in-memory store, demo data, and routes |
| Capabilities | Projects, tasks, milestones, resources, activity logs, templates (SaaS, construction), dashboard |
| APIs | `GET/POST /api/protoi/projects`, `GET /api/protoi/templates` |
| Storage | In-memory `Map` (`ProtoIStore`); no persistent backend |
| Tests | None found for `protoi` specifically |
| Dependencies | Next.js, React, Tailwind, `lucide-react` |
| Owner/Source | `apps/ursula-frontend/src/lib/protoi/` |

Files:

- `apps/ursula-frontend/src/lib/protoi/types.ts` — `ProtoProject`, `ProtoMilestone`, `ProtoTask`, `ProtoResource`, `ProtoLog`, `ProtoTemplate`.
- `apps/ursula-frontend/src/lib/protoi/store.ts` — `ProtoIStore` with demo templates and a seeded project.
- `apps/ursula-frontend/src/app/protoi/page.tsx` — dashboard listing projects and templates.
- `apps/ursula-frontend/src/app/protoi/projects/[id]/page.tsx` — project detail with task board, milestones, resources, logs.
- `apps/ursula-frontend/src/app/api/protoi/projects/route.ts` — `GET` list, `POST` create from template.
- `apps/ursula-frontend/src/app/api/protoi/templates/route.ts` — `GET` list templates.

Domain model:

- **Projects:** `id`, `title`, `description`, `category`, `status`, `priority`, `ownerId`, `startDate`, `targetDate`, `budget`, `spent`, milestones, tasks, resources, logs.
- **Milestones:** `id`, `title`, `description`, `dueDate`, `status` (`pending` | `achieved` | `missed`).
- **Tasks:** `id`, `title`, `description`, `status` (`backlog` | `todo` | `in_progress` | `review` | `done`), `priority`, `assigneeId`, `estimatedHours`, `actualHours`, `dependsOn`, `milestoneId`.
- **Resources:** `id`, `name`, `type` (`material` | `tool` | `budget` | `time` | `person`), `allocated`, `used`.
- **Logs:** `id`, `type` (`note` | `photo` | `voice` | `metric`), `content`, `attachments`.
- **Templates:** `id`, `name`, `description`, `category`, `defaultTasks`, `defaultMilestones`, `defaultResources`.

### 1.5 ProtoForge generated `proto-yi` application

| Field | Value |
|-------|-------|
| Path | `protoforge-applications/proto-yi/` |
| Project Name | Proto YI (`proto-yi` package, `Proto YI` manifest) |
| Technology | Node.js, Express, CommonJS, HTML/CSS/JS static client |
| Status | ProtoForge factory scaffold; canonical application identity reserved |
| Capabilities | Generic `Record` CRUD, health endpoint, event bus, memory/JSON persistence |
| APIs | `GET /health`, `POST/GET /records`, `GET/PUT/DELETE /records/:id` |
| Storage | In-memory or JSON file (`src/persistence/`) |
| Tests | `protoforge-applications/proto-yi/tests/blueprint.test.js` — 3 tests |
| Dependencies | `bcryptjs`, `cors`, `express` |
| Owner/Source | Generated by `protoforge/tools/create-app`; canonical path under `protoforge-applications/` |

Files:

- `protoforge-applications/proto-yi/manifest.json` — ProtoForge application manifest; declares `governance.domain = project-management`.
- `protoforge-applications/proto-yi/package.json` — `name: "proto-yi"`, Express app.
- `protoforge-applications/proto-yi/src/index.js` — server bootstrap.
- `protoforge-applications/proto-yi/src/api/router.js` — Express routes (generic `Record` CRUD).
- `protoforge-applications/proto-yi/src/repository.js` — `Repository` class with `createRecord`, `getRecord`, `listRecords`, `updateRecord`, `deleteRecord`.
- `protoforge-applications/proto-yi/src/events/event-bus.js` — `EventBus`, `MemoryTransport`, `FileTransport`, `ExternalAdapter` (for HYDI Event Gateway).
- `protoforge-applications/proto-yi/tests/blueprint.test.js` — factory blueprint tests.

Notable: the repository currently holds only a `Record` placeholder. The project-management domain will be layered in through the adapter boundary without duplicating the Flask engine.

### 1.6 Procedural-memory `Proto-YI` (unrelated AI concept)

| Field | Value |
|-------|-------|
| Path | `heidi-core/seed-procedural-memory.js` (line 119), `supabase/migrations/20260626140000_seed_procedural_memory.sql` (line 28) |
| Project Name | Proto-YI (design generation) |
| Technology | JavaScript seed, SQL seed |
| Status | Procedural-memory seed only |
| Capabilities | "Gemini vision API to analyze mood boards, then generates 5 concept variations" |
| Storage | `procedural_memory` table (Supabase) |
| Tests | None |
| Owner/Source | Seed scripts |

This is an unrelated use of the `Proto-YI` name. It has no code implementation and should not be confused with the project-management system.

### 1.7 `hdi-three-agent-panel.html` reference

| Field | Value |
|-------|-------|
| Path | `hdi-three-agent-panel.html` (line 452) |
| Reference | `<div class="sidebar-item" onclick="setSideFilter('ProtoIY')">Proto.I.Y</div>` |
| Status | UI label only; no linked implementation in the HYDI repo |
| Owner | `hdi-three-agent-panel.html` |

### 1.8 Inventory `ProtoYI RCWS` stub

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/src/components/modules/InventoryModule.tsx` (lines 918–922) |
| Reference | `id: 'protoyi-rcws'`, `name: 'ProtoYI RCWS'`, `path: 'ProtoYI_RCWS/'` |
| Status | Hard-coded inventory entry; no filesystem implementation in the HYDI repo |
| Owner | Ursula inventory module only |

---

## 2. Ownership boundaries

| System | Role | Owner path | Canonical? | Action |
|--------|------|------------|------------|--------|
| **ProtoForge `proto-yi` application** | Canonical application identity, orchestration, manifest, lifecycle | `protoforge-applications/proto-yi/` | **Yes** | Keep; do not rename; build adapter |
| **Flask `ProtoIY` engine** | Legacy domain source of truth (projects, timelines, SQLite) | `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\` | No (legacy) | Do not modify; wrap via adapter |
| **Next.js `protoi` UI** | Legacy presentation layer | `apps/ursula-frontend/src/lib/protoi/`, `src/app/protoi/` | No (legacy) | Do not modify; replace with canonical UI later |
| **Ursula dashboard** | Health/monitoring dashboard | `C:\ProtoForge_Ecosystem\Ursula_Suite\dashboard\` | No | Keep; it will poll the new canonical app |
| **Procedural-memory `Proto-YI`** | Unrelated AI concept | `heidi-core/seed-procedural-memory.js`, `supabase/migrations/` | No | Do not reuse; retire or rename in future |
| **Inventory `protoyi-rcws`** | Stub | `apps/ursula-frontend/src/components/modules/InventoryModule.tsx` | No | Remove or rename when inventory is next updated |

---

## 3. Current capabilities comparison

| Capability | Flask Proto.I.Y | Next.js `protoi` UI | ProtoForge `proto-yi` | Canonical future owner |
|------------|-----------------|---------------------|-----------------------|------------------------|
| **Project creation** | SQLite `create_project(name, category, owner_id)` | In-memory `ProtoProject` with templates | `Record` placeholder only | Flask engine via adapter → ProtoForge app |
| **Timeline generation** | `create_timeline(project_id, milestones, start_date, duration_days)` | `startDate`, `targetDate`, milestone model | None | Flask engine via adapter → ProtoForge app |
| **Milestone tracking** | Yes, with contiguous date progression | Yes (`pending/achieved/missed`) | None | Adapter will surface Flask milestones as events |
| **Tasks** | No | Yes (`ProtoTask`, task board) | None | Next.js UI logic may be ported later |
| **Resources** | No | Yes (`ProtoResource`) | None | Port from Next.js UI or re-implement |
| **Budget** | Hours-based (`duration_hours`) | Yes (`budget`, `spent`) | None | Merge both models in canonical app |
| **Persistence** | SQLite (durable) | In-memory only | Memory / JSON | SQLite remains source of truth until migration |
| **Event emission** | No | No | `record.created/updated/deleted` (placeholder) | Canonical app will emit `project.*`, `milestone.*` |
| **HYDI Event Gateway integration** | No | No | `ExternalAdapter` ready | Canonical app will use adapter |
| **Tests** | 32 pytest tests | None | 3 Node tests (blueprint) | Use Flask tests as adapter contract; add canonical app tests |
| **API surface** | Flask `POST /proto_iy/*` | Next.js `GET/POST /api/protoi/*` | Express `/records` CRUD | New Express/Next.js routes in ProtoForge app |
| **Frontend** | Flask `dashboard/index.html` | Next.js `/protoi/*` | `public/index.html` stub | New UI in ProtoForge app or Ursula module |

---

## 4. Test coverage evidence

### Flask Proto.I.Y (Ursula Suite)

- **Suite:** `C:\ProtoForge_Ecosystem\Ursula_Suite\tests\test_proto_iy.py`
- **Command:** `python -m pytest tests/test_proto_iy.py -q`
- **Result:** `32 passed in 5.80s`
- **Coverage areas:**
  - Project creation (basic, categories, multiple, different owners)
  - Timeline generation (basic, retrieval, duration, single, many, date progression)
  - Infrastructure categories
  - Budget / material hours
  - HYDI integration (structure, access, data shape, receives project data)
  - Edge cases (empty name)

No test failures were observed.

### ProtoForge `proto-yi` blueprint

- **Suite:** `protoforge-applications/proto-yi/tests/blueprint.test.js`
- **Command:** `npm test` (Node test runner)
- **Result:** `3 passed, 0 failed`
- **Coverage areas:**
  - Creates and retrieves records
  - Emits domain events (`record.created`)
  - Exposes API endpoints (`GET /health`)

### HYDI Jest Proto YI

- **Suites:** `tests/unit/proto-yi.test.js`, `tests/unit/proto-yi-certification.test.js`
- **Command:** `npx jest tests/unit/proto-yi.test.js tests/unit/proto-yi-certification.test.js --forceExit`
- **Result:** `2 suites passed, 15 tests passed, 0 failed`
- **Coverage areas:**
  - Generated structure
  - Manifest validity
  - Application registry registration
  - validate-app pass
  - Certification (capabilities, events, dependencies, governance, dependency graph)

### ProtoForge certification package

- **Suite:** `protoforge/packages/certification/tests/certifier.test.js`
- **Command:** `npm test`
- **Result:** `18 passed, 0 failed`
- **Coverage areas:**
  - Proto YI certification passes
  - Event namespacing
  - Dangerous event detection
  - Policy validation
  - Dependency graph integration

### ProtoForge validate-app tool

- **Suite:** `protoforge/tools/validate-app/tests/validator.test.js`
- **Command:** `npm test`
- **Result:** `10 passed, 0 failed`
- **Coverage areas:**
  - Manifest validation
  - Required files
  - Capability policy validation

---

## 5. Runtime registration evidence

Proto YI is already registered in the ProtoForge application registry and diagnostics:

| Registry | Evidence |
|----------|----------|
| `ApplicationRegistry.get('Proto YI')` | Returns `{ name: 'Proto YI', version: '0.1.0', status: 'active' }` |
| `validate-app` | Passes with `ok: true` and `manifest.name === 'Proto YI'` |
| `certification` package | `certify('proto-yi')` passes all checks |
| Platform diagnostics | `getRuntimeInventory()` lists `Proto YI` with capabilities, events, and policy status |

This confirms `protoforge-applications/proto-yi` is the correct canonical application identity.

---

## 6. HYDI / event compatibility status

| System | Emits to HYDI? | Consumes from HYDI? | HYDI-ready? | Notes |
|--------|----------------|---------------------|-------------|-------|
| Flask `proto_iy.py` | No | No | No | Pure SQLite engine; no event transport |
| Next.js `protoi` UI | No | No | No | In-memory only; no event bus |
| ProtoForge `proto-yi` | Placeholder `record.*` events | No | Partial | `ExternalAdapter` can forward to HYDI Event Gateway once configured |

To become fully HYDI-compatible, the canonical `proto-yi` application must:

1. Replace `Record` domain with real `Project`, `Milestone`, `Task`, `Resource` entities.
2. Emit canonical `project.*`, `milestone.*`, `task.*`, `resource.*` events.
3. Use `ExternalAdapter` to `POST` to `protoforge/hydi-gateway/POST /events`.
4. Consume policy decisions from ProtoForge (`protoforge.policy.approved`, `protoforge.policy.rejected`).
5. Persist state in a durable store (SQLite/Supabase) rather than in-memory JSON.

---

## 7. Naming collision analysis

| Variant | Where found | Canonical? | Action |
|---------|-------------|------------|--------|
| `proto-yi` | `protoforge-applications/proto-yi/package.json` | **Yes** | Keep |
| `Proto YI` | `protoforge-applications/proto-yi/manifest.json` | **Yes** | Keep |
| `protoi` | `apps/ursula-frontend/src/lib/protoi/`, `src/app/protoi/` | No | Legacy; do not extend |
| `Proto.I.Y` | `hdi-three-agent-panel.html` | No | UI label; re-label to canonical name later |
| `proto_iy` | `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\` | No | Legacy engine; wrap via adapter |
| `ProtoIY` | `C:\ProtoForge_Ecosystem\Ursula_Suite\ursula_server.py`, `C:\ProtoForge_Ecosystem\Ursula_Suite\dashboard\routes.py` | No | Legacy; rename references to canonical `proto-yi` in adapter |
| `Proto-YI` | `heidi-core/seed-procedural-memory.js`, `supabase/migrations/` | No | Unrelated AI concept; retire or rename |
| `protoyi-rcws` | `apps/ursula-frontend/src/components/modules/InventoryModule.tsx` | No | Stub; remove or rename |

The canonical names `proto-yi` and `Proto YI` are now reserved for the ProtoForge application. All other occurrences are legacy, stub, or unrelated.

---

## 8. Recommended canonical architecture

The Proven Resonate pattern is:

```text
Next.js ProtoIY UI          (legacy, presentation only)
        |
        v
ProtoForge Application Wrapper
        (protoforge-applications/proto-yi)
        - manifest
        - capabilities
        - lifecycle
        - events
        - orchestration
        |
        v
Proto.I.Y Engine Adapter
        - translates between Flask SQLite model and canonical events
        - emits project.created, milestone.reached, etc.
        - does not duplicate business logic
        |
        v
Existing Flask Proto.I.Y Engine
        (C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\)
        - remains source of truth for projects & timelines
        - no modifications
        |
        v
HYDI Event Gateway
        |
        v
RAW EVENT LEDGER
        |
        v
CASCADE / KILO / Policy Engine
```

### Adapter contract (recommended)

The adapter should live under the canonical application, e.g.:

```
protoforge-applications/proto-yi/src/adapters/protoiy-engine.js
```

It should translate existing Flask operations to canonical events and API calls:

| Flask operation | Canonical event | REST route (canonical) |
|-----------------|-----------------|------------------------|
| `create_project(name, category, owner_id)` | `project.created` | `POST /projects` |
| `create_timeline(...)` | `milestone.created` (per milestone) | `POST /projects/:id/timelines` |
| `get_project_timeline(project_id)` | `project.timeline.retrieved` | `GET /projects/:id/timelines` |

Canonical event types to reserve for Proto YI:

```text
project.created
project.updated
project.deleted
milestone.created
milestone.reached
milestone.missed
task.created
task.updated
task.completed
resource.allocated
project.log.added
```

### Boundary rules

1. **Do not duplicate Flask `ProtoIY` project/timeline logic.** The adapter calls the existing engine.
2. **Do not modify the Flask engine.** It remains the source of truth until a future data migration.
3. **Do not modify the Next.js `protoi` UI.** It will be replaced by the canonical ProtoForge UI when ready.
4. **Do not modify unrelated ProtoForge applications** (`switchboard/`, `rezonate/`, `protoforge-applications/rezonate/`).
5. **ProtoForge `proto-yi` owns orchestration, manifests, capabilities, lifecycle, and event contracts.**
6. **The Flask engine owns the durable project/timeline data.**

---

## 9. Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| No duplicate Proto YI business logic created | ✅ No new logic created; only documentation |
| Existing Flask Proto.I.Y remains untouched | ✅ No changes to `C:\ProtoForge_Ecosystem\Ursula_Suite\apps\proto_iy\` |
| Existing UI remains untouched | ✅ No changes to `apps/ursula-frontend/src/lib/protoi/` or `src/app/protoi/` |
| Clear canonical ownership documented | ✅ `protoforge-applications/proto-yi/` is canonical |
| Future migration path matches Resonate architecture | ✅ Adapter + legacy engine pattern documented |

---

## 10. Files changed in this phase

Only documentation files were changed:

- `docs/PROTO_YI_SYSTEM_RECONCILIATION.md` (this file)
- `docs/CANONICAL_PLATFORM_COMPONENTS.md`
- `docs/PLATFORM_NAMING_GUIDE.md`

No application code was created or modified.
