# Proto YI / Proto.I.Y System Reconciliation Audit

## Executive summary

The repository contains **at least three distinct Proto-YI-branded concepts** and **two overlapping project-management implementations** under the same family of names. Phase 7.5 is a documentation-only audit to prevent another Resonate/CASCADE-style naming collision before Phase 8 proceeds.

| Finding | Count |
|---------|-------|
| Distinct name variants found | 5 (`proto-yi`, `proto_yi`, `proto iy`, `proto.i.y`, `ProtoYI`) |
| Existing project-management code locations | 2 |
| Creative/AI-generation references | 2 (procedural memory) |
| Reserved-name policy collisions | 1+ |
| Frontend UI routes | 2 (`/protoi`, `/protoi/projects/[id]`) |

**Primary collision:** the generated `protoforge-applications/proto-yi/` application is a project-management scaffold that was placed under the reserved `Proto YI` / `Proto.I.Y` name, while an in-Ursula `Proto.I.Y` project-wizard already exists with a richer domain model. The canonical `Proto YI` name is reserved for a future builder/integrator assistant (`protoforge/proto-yi/`), not for a project-management domain.

No application code was modified in this phase.

## Method

Searched the repository for the following terms and variants:

```text
proto-yi
proto_yi
proto iy
proto.i.y
ProtoYI
Proto YI
Proto.I.Y
project management
timeline
milestone
task management
project wizard
```

Searched: code, filenames, exports/imports, route handlers, READMEs, architecture docs, comments, TODOs, frontend components, Supabase migrations, and procedural-memory seeds.

---

## 1. Existing systems inventory

### 1.1 Ursula Proto.I.Y Project Wizard (existing, most mature)

| Field | Value |
|-------|-------|
| Path | `apps/ursula-frontend/src/lib/protoi/`, `apps/ursula-frontend/src/app/protoi/`, `apps/ursula-frontend/src/app/api/protoi/` |
| Project Name | Proto.I.Y (UI labels: "PROTOI // PROJECT WIZARD", "DIY project management with AI-powered guidance") |
| Technology | TypeScript, Next.js App Router, React, Tailwind |
| Status | Active UI with local in-memory store, demo data, and routes |
| Capabilities | Projects, tasks, milestones, resources, activity logs, templates (SaaS, construction), dashboard |
| APIs | `GET/POST /api/protoi/projects`, `GET /api/protoi/templates` |
| Storage | In-memory `Map` (`ProtoIStore`); no persistent backend |
| Tests | None found for `protoi` specifically |
| Dependencies | Next.js, React, Tailwind, `lucide-react` (icons) |
| Owner/Source | `apps/ursula-frontend/src/lib/protoi/` |

Files:

- `apps/ursula-frontend/src/lib/protoi/types.ts` — `ProtoProject`, `ProtoMilestone`, `ProtoTask`, `ProtoResource`, `ProtoLog`, `ProtoTemplate` types.
- `apps/ursula-frontend/src/lib/protoi/store.ts` — `ProtoIStore` with demo templates and a seeded project (`HYDI System Consolidation`).
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

Ursula module integration:

- `apps/ursula-frontend/src/lib/modules.ts` includes a generic `projectops` module, but `protoi` itself is not in `MODULES`.
- `apps/ursula-frontend/src/lib/module-groups.ts` groups `projectops` under the `dev-suite`.

### 1.2 ProtoForge generated Proto YI (new, scaffold)

| Field | Value |
|-------|-------|
| Path | `protoforge-applications/proto-yi/` |
| Project Name | Proto YI (`proto-yi` package, `Proto YI` manifest) |
| Technology | Node.js, Express, CommonJS, HTML/CSS/JS static client |
| Status | ProtoForge factory scaffold; generated application |
| Capabilities | Generic `Record` CRUD, health endpoint, event bus, memory/JSON persistence |
| APIs | `GET /health`, `POST/GET /records`, `GET/PUT/DELETE /records/:id` |
| Storage | In-memory or JSON file (`src/persistence/`) |
| Tests | `protoforge-applications/proto-yi/tests/blueprint.test.js` (Node test runner) |
| Dependencies | `bcryptjs`, `cors`, `express` |
| Owner/Source | Generated by `protoforge/tools/create-app` |

Files:

- `protoforge-applications/proto-yi/manifest.json` — ProtoForge application manifest, declares domain `project-management`.
- `protoforge-applications/proto-yi/package.json` — `name: "proto-yi"`, Express app.
- `protoforge-applications/proto-yi/src/index.js` — server bootstrap.
- `protoforge-applications/proto-yi/src/api/router.js` — Express routes (generic `Record` CRUD).
- `protoforge-applications/proto-yi/src/repository.js` — `Repository` class with `createRecord`, `getRecord`, `listRecords`, `updateRecord`, `deleteRecord`.
- `protoforge-applications/proto-yi/src/events/event-bus.js` — `EventBus`, `MemoryTransport`, `FileTransport`, `ExternalAdapter`.
- `protoforge-applications/proto-yi/public/index.html`, `public/ui.js`, `public/styles.css` — minimal static client.
- `protoforge-applications/proto-yi/docs/ARCHITECTURE.md`, `docs/EVENTS.md`, `docs/GETTING_STARTED.md` — template docs.

Notable: the repository currently holds only a `Record` placeholder. No project, milestone, task, or resource domain exists yet.

### 1.3 ProtoYI RCWS (stub)

| Field | Value |
|-------|-------|
| Path | `ProtoYI_RCWS/` (referenced) — not present on disk |
| Project Name | ProtoYI RCWS |
| Technology | React, Node.js (per inventory data) |
| Status | Scaffolded / not implemented |
| Capabilities | "Bot hook engine, checkpoint system" (per inventory description only) |
| Storage | N/A |
| Tests | None |
| Owner/Source | `apps/ursula-frontend/src/components/modules/InventoryModule.tsx` data row |

This is a hard-coded inventory entry. No filesystem implementation was found.

### 1.4 Procedural-memory Proto-YI (creative AI concept)

| Field | Value |
|-------|-------|
| Path | `heidi-core/seed-procedural-memory.js`, `supabase/migrations/20260626140000_seed_procedural_memory.sql` |
| Project Name | Proto-YI (design generation) |
| Technology | JavaScript seed, SQL seed |
| Status | Procedural-memory seed only |
| Capabilities | "Gemini vision API to analyze mood boards, then generates 5 concept variations" |
| Storage | `procedural_memory` table (Supabase) |
| Tests | None |
| Owner/Source | `heidi-core/seed-procedural-memory.js` and Supabase migration |

This is a third, unrelated use of the `Proto-YI` name for an AI design-generation service. It has no code implementation, only seed data.

### 1.5 Reserved-name documentation

| Field | Value |
|-------|-------|
| Path | `docs/RESERVED_COMPONENT_NAMES.md`, `docs/PLATFORM_NAMING_GUIDE.md`, `docs/CANONICAL_PLATFORM_COMPONENTS.md` |
| Declared Owner | `Proto YI` — `protoforge/proto-yi/` (reserved) |
| Declared Purpose | Builder / integrator assistant |
| Status | Reserved; canonical path says "do not create yet" |

---

## 2. Capability comparison

| Capability | Existing Proto.I.Y (Ursula) | protoforge-applications/proto-yi | Notes |
|------------|-----------------------------|----------------------------------|-------|
| **Project management** | Full `ProtoProject` model with status, priority, dates, budget | Only `Record` placeholder | Existing is far more mature. |
| **Timeline management** | `startDate`, `targetDate`, `completedDate` per project | None | N/A. |
| **Milestones** | First-class `ProtoMilestone` with status `pending/achieved/missed` | None | Existing wins. |
| **Tasks** | `ProtoTask` with workflow `backlog/todo/in_progress/review/done`, dependencies, assignee | None | Existing wins. |
| **Resources** | `ProtoResource` with allocation/usage tracking | None | Existing wins. |
| **Activity logs** | `ProtoLog` with note/photo/voice/metric types | None | Existing wins. |
| **Templates** | `ProtoTemplate` with default tasks/milestones/resources | None | Existing wins. |
| **Frontend UI** | Next.js dashboard + project detail + templates | `public/index.html` stub | Existing wins. |
| **APIs** | `/api/protoi/projects`, `/api/protoi/templates` | `/records` CRUD | Existing is domain-specific. |
| **Event producers** | None (in-memory only, no event bus) | `record.created/updated/deleted` | New app has event skeleton. |
| **Event consumers** | None | None | Both empty. |
| **Persistence** | In-memory Maps | Memory / JSON store | New app has persistence layer. |
| **Tests** | None found | `tests/blueprint.test.js` | New app has factory tests. |
| **Manifest / governance** | None | `manifest.json` with `governance.domain = project-management` | New app is ProtoForge-registered. |
| **Integrations** | None wired | `ExternalAdapter` for HYDI Event Gateway | New app can emit to platform. |

Summary: the **existing Proto.I.Y** is a richer project-management UI with a complete domain model. The **new ProtoForge `proto-yi`** is a generic factory scaffold that currently has no project-management functionality but has the correct ProtoForge structure (manifest, event bus, adapter, tests).

---

## 3. Canonical ownership recommendation

| Option | Evaluation | Verdict |
|--------|------------|---------|
| **A — ProtoForge Proto YI wraps existing Proto.I.Y** | The new `proto-yi` is an empty Express scaffold. Wrapping the Ursula React store would require a new Next.js/Express bridge and a full domain port. Possible but not the immediate, lowest-risk path. | Feasible, but not Phase 8 ready. |
| **B — Existing Proto.I.Y becomes legacy and migrates into ProtoForge** | The Ursula code has the only real project-management domain. Migrating it into a ProtoForge application is the correct long-term canonicalization. However, that is a non-trivial migration. | Long-term correct. |
| **C — Both remain separate with explicit naming** | This is the status quo and is exactly what caused the Resonate collision. The two would continue to fight over `Proto YI` / `protoi` names. | **Rejected** — it does not solve the collision. |
| **D — Rename protoforge-applications/proto-yi before further development** | The generated app currently uses a reserved/colliding name and has no real domain yet. Renaming it is cheap, immediately decouples it from the `Proto YI` brand, and lets Phase 8 continue with a clean name. The existing Ursula `Proto.I.Y` can then be renamed in a follow-up migration. | **Recommended immediate action.** |

**Recommendation:**

1. **Immediate (Phase 7.5 → Phase 8):** Choose **Option D**. Rename `protoforge-applications/proto-yi` to a non-colliding, domain-specific name.
2. **Follow-up (Phase 9 / migration):** Execute **Option B** — port the Ursula `Proto.I.Y` domain into the newly-named ProtoForge application, then retire the old `protoi` routes.

---

## 4. Naming decision

### Names to reserve

The following names must be reserved exclusively for the canonical builder/integrator assistant described in `docs/RESERVED_COMPONENT_NAMES.md`:

- `Proto YI`
- `Proto.I.Y`
- `proto-yi`
- `proto_yi`
- `protoyi`
- `ProtoYI`

These names must not be used for the project-management application, the AI design-generation concept, or any other unrelated feature.

### Recommended final name for the project-management ProtoForge app

| Current | Proposed |
|---------|----------|
| `protoforge-applications/proto-yi` | `protoforge-applications/project-wizard` |
| Package name `proto-yi` | `project-wizard` |
| Manifest `name` `Proto YI` | `Project Wizard` |
| Display title in UI | `Project Wizard` |

Rationale:

- The Ursula UI already calls itself a "Project Wizard".
- `project-wizard` is descriptive, kebab-case, and does not collide with `Proto YI` or `ProtoForge`.
- It aligns with the `governance.domain = project-management` field already declared in the manifest.
- It preserves the factory-generated structure and event contracts.

### Recommended renaming for the existing Ursula implementation

| Current | Proposed (legacy) |
|---------|-------------------|
| `apps/ursula-frontend/src/lib/protoi/` | `apps/ursula-frontend/src/lib/legacy-project-wizard/` (or `legacy-protoi/`) |
| `apps/ursula-frontend/src/app/protoi/` | `apps/ursula-frontend/src/app/legacy-project-wizard/` |
| `apps/ursula-frontend/src/app/api/protoi/` | `apps/ursula-frontend/src/app/api/legacy-project-wizard/` |
| UI title "PROTOI // PROJECT WIZARD" | "Legacy Project Wizard" |

After migration into `project-wizard`, these legacy paths can be deleted.

---

## 5. Integration boundary

If the existing Ursula `Proto.I.Y` is retained as a valuable UI during transition, the canonical architecture should be:

```text
┌─────────────────────────────────────────────────────────────┐
│ Existing Proto.I.Y (Ursula frontend)                        │
│ - in-memory store, demo data, React UI                      │
│ - emits none today                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       v
┌─────────────────────────────────────────────────────────────┐
│ ProtoForge migration adapter                                │
│ - reads from ProtoIStore or JSON export                     │
│ - translates `ProtoProject`, `ProtoTask`, `ProtoMilestone`  │
│   into `project.created`, `task.created`,                   │
│   `milestone.reached` canonical events                      │
│ - forwards to HYDI Event Gateway POST /events               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       v
┌─────────────────────────────────────────────────────────────┐
│ Canonical Project Wizard (ProtoForge application)           │
│ - domain: project-management                                │
│ - persistence: JSON / memory / Supabase                     │
│ - events: `project.*`, `task.*`, `milestone.*`              │
│ - external adapter: `ExternalAdapter` to HYDI Gateway       │
└─────────────────────────────────────────────────────────────┘
```

### Suggested adapter contract

The adapter should live under the canonical application, e.g.:

```
protoforge-applications/project-wizard/src/adapters/protoi-migration.js
```

It should translate these existing types to canonical events:

| Existing type | Canonical event |
|---------------|-----------------|
| `ProtoProject` | `project.created` / `project.updated` |
| `ProtoTask` | `task.created` / `task.completed` / `task.updated` |
| `ProtoMilestone` | `milestone.reached` / `milestone.missed` |
| `ProtoLog` | `project.log.added` |

The canonical event types in `project-wizard` should then be reserved as:

```text
project.created
project.updated
project.deleted
task.created
task.updated
task.completed
milestone.reached
milestone.missed
project.log.added
```

---

## Preserved systems

Per the audit constraints, the following are explicitly preserved and **not** renamed or deleted:

- `switchboard/`
- `rezonate/`
- `protoforge-applications/rezonate/`
- `apps/ursula-frontend/src/lib/protoi/` and `src/app/protoi/` (existing Proto.I.Y source)

Only documentation was produced in this phase.

---

## Action items (for Phase 8 planning)

1. Rename `protoforge-applications/proto-yi` to `protoforge-applications/project-wizard`.
2. Update the package name in `package.json` from `proto-yi` to `project-wizard`.
3. Update the manifest `name` from `Proto YI` to `Project Wizard`.
4. Update `governance.domain` if needed (keep `project-management`).
5. Update `tests/unit/proto-yi.test.js` to point at the new directory and rename the test file.
6. Update `protoforge/packages/certification/tests/certifier.test.js` references from `Proto YI` to `Project Wizard`.
7. Update `docs/RESERVED_COMPONENT_NAMES.md` and `docs/PLATFORM_NAMING_GUIDE.md` to reserve `Proto YI` for the canonical builder/integrator assistant and list `Project Wizard` as the canonical project-management app.
8. After `project-wizard` is functional, plan the `protoi` → `project-wizard` migration adapter and eventual retirement of the Ursula `protoi` routes.
