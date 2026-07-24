# Evolution Engine

`EvolutionEngine` is a Kernel-managed HYDI V4 module for evidence-driven engineering planning. It observes repository and runtime state, ranks measurable improvements, generates reversible engineering packets, validates approved work, and records outcomes.

## Lifecycle

The Kernel initializes, starts, stops, and disposes the module. Scheduled cycles are disabled unless `autoStart: true` is explicitly configured. The schedule timer is unreferenced and cleared during shutdown.

## Cycle

1. Observe repository audit, Kernel health, system intelligence metrics, and scorecard output.
2. Prioritize candidates into `immediate`, `nextSprint`, and `longTerm` queues using deterministic severity weights.
3. Design an engineering packet containing architecture, dependency, security, performance, rollback, migration, test, documentation, and validation plans.
4. Require explicit plan approval before execution.
5. Run the configured validator before an executor can run.
6. Persist completed, rejected, and failed outcomes locally and through the Memory Bus learning namespace.

## Safety Model

The module does not modify source code, execute shell commands, commit, or deploy by itself. `executeApproved` requires all of the following:

- A proposed plan has been explicitly approved.
- The Kernel permission model allows `execute` on `evolution`.
- A caller supplies an executor function.
- The configured validator passes.

A failed validator records a rejected outcome and does not call the executor.

## Events

- `evolution.observed`
- `evolution.planned`
- `evolution.learned`

## Persistent State

History is stored under `<kernel dataPath>/evolution/history.json` by default. The latest observed state and learning records are stored through the Memory Bus in the `evolution` namespace.

## ProtoForge

`productize(moduleId)` generates ProtoForge artifacts for an already registered module. It does not publish or deploy those artifacts.
