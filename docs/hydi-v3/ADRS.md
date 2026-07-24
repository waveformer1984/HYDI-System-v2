# HYDI V3 Architecture Decision Records

This file records the key architectural decisions behind the V3 reliability and autonomy layer.

## ADR-001: Modular Autonomy Layer

**Status:** Accepted

**Context:** The V2 core had no formal reliability, mission planning, or recovery abstractions. Reliability logic was scattered and hard to test.

**Decision:** Introduce a dedicated `src/hydi-v3` package with focused, single-responsibility modules (`WatchdogSupervisor`, `HeartbeatSystem`, `MissionPlanner`, etc.). `HYDIAutonomyManager` wires them and patches the V2 core loop.

**Consequences:**
- Each module can be unit-tested in isolation.
- V2 code remains largely unchanged.
- Module count grew, but boundaries are clear.

## ADR-002: EventEmitter-Based Communication

**Status:** Accepted

**Context:** Modules need to react to events (agent death, heartbeat missing, mission completed) without tight coupling.

**Decision:** All major V3 modules extend Node.js `EventEmitter`. `HYDIAutonomyManager` subscribes to cross-module events in `setupInternalListeners()`.

**Consequences:**
- Loose coupling between `MissionPlanner`, `SelfHealingEngine`, `ReflectionEngine`, etc.
- Easy to add new subscribers.
- Risk of memory leaks if listeners are not removed; mitigated by `destroy()` methods.

## ADR-003: JSON File Persistence

**Status:** Accepted

**Context:** Missions, decisions, reflections, and checkpoints must survive process restarts. A full database migration was considered but would be high-risk for V2.

**Decision:** Persist state as JSON files under `data/` (or `config.dataPath`). `Map` objects are serialized with a custom replacer and rehydrated on load.

**Consequences:**
- Simple to back up and restore.
- No schema migration required.
- Not suitable for high-frequency writes or concurrent multi-node access.
- File corruption is handled by `MemoryIntegrity` and checkpoint recovery.

## ADR-004: Mission / Objective / Task Hierarchy

**Status:** Accepted

**Context:** V2 executed isolated tasks. We needed dependency ordering, priorities, deadlines, and revenue tracking.

**Decision:** `MissionPlanner` introduces a three-level hierarchy: mission > objective > task. Tasks support dependencies, priorities, deadlines, and automatic replanning.

**Consequences:**
- Revenue work can be modeled as missions with revenue targets.
- `coreLoop.getPendingTasks()` is patched to return ready mission tasks.
- Topological sorting enables correct dependency order.
- Failed tasks retry up to three times before becoming permanently failed.

## ADR-005: Validate Decisions Before Execution

**Status:** Accepted

**Context:** The V2 core loop decides and executes in one step. We needed a gate to prevent dangerous or low-confidence actions.

**Decision:** Patch `coreLoop.takeAction()` so `DecisionIntelligence.validateDecision()` runs before the original action. Invalid decisions return `{ status: 'rejected', reason }`.

**Consequences:**
- Dangerous actions (`delete`, `drop`, etc.) are rejected.
- Low-confidence, high-risk, or missing-credential decisions are blocked.
- Slight latency increase (validated synchronously before execution).

## ADR-006: Self-Healing with Exponential Backoff

**Status:** Accepted

**Context:** Services fail transiently. We want automatic recovery without overwhelming upstream systems or looping forever.

**Decision:** `SelfHealingEngine` maps symptom types to recovery plans and retries with exponential backoff plus jitter. It escalates after `maxAttempts`.

**Consequences:**
- Reduces operator toil for transient failures.
- Bounded retry prevents infinite loops.
- Default actions return `{ success: true }`; production deployments must supply real action handlers.

## ADR-007: Decaying Strategy Rankings

**Status:** Accepted

**Context:** We need to learn which strategies produce revenue over time without being dominated by old data.

**Decision:** `ReflectionEngine` maintains per-category `Map`s of strategy scores. Scores decay by `decayFactor` per sample and update with each completed task.

**Consequences:**
- Recent outcomes weigh more heavily.
- Best/worst strategies are surfaced per category (`revenue`, `outreach`, `coding`, etc.).
- Requires enough mission volume to be statistically meaningful.

## ADR-008: Distributed Compute Node Registry

**Status:** Accepted

**Context:** Future scaling may distribute work across multiple compute nodes.

**Decision:** `DistributedCompute` maintains an in-memory registry of nodes with CPU, RAM, GPU, latency, workload, and capabilities. The scheduler scores nodes and redistributes work on failure.

**Consequences:**
- Single-node deployments still register a local node.
- Multi-node support is structural but not network-aware yet.
- Work redistribution on node failure is automatic.

## ADR-009: Nightly Memory Integrity Scan

**Status:** Accepted

**Context:** JSON persistence and long-running processes can produce duplicate IDs, corrupted Maps, orphan records, or invalid timestamps.

**Decision:** `MemoryIntegrity` runs a configurable scan (default every 24 hours) and can be triggered manually via `runScan()`.

**Consequences:**
- Detects data corruption early.
- Some issues are auto-repaired in place.
- Severe corruption still requires backup restore.

## ADR-010: Externalize Operational Scripts

**Status:** Accepted

**Context:** Production readiness requires repeatable benchmarks, audits, and soak tests.

**Decision:** Keep operational entry points as scripts in `scripts/` (`security-audit.js`, `performance-benchmark.js`, `soak-test.js`, `production-readiness-score.js`) and wire them to `package.json` scripts.

**Consequences:**
- CI can run the same commands as developers.
- Scripts are linted and typechecked alongside source.
- Additional scripts increase maintenance surface.
