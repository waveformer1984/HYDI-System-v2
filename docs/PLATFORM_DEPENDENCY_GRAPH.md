# Platform Dependency Graph

## Canonical data flow

```mermaid
flowchart TB
    subgraph Applications
        RES[Resonate]
        SW[Switchboard]
        URS[Ursula / Chat UI]
    end

    RES -->|ExternalAdapter| G[HYDI Event Gateway]
    SW -->|HydiAdapter| G
    URS -->|api/chat/route.js| G

    G -->|POST /events| R[RAW Ledger Adapter]
    R -->|write| DB[(raw_event_ledger Supabase table)]

    DB -->|read| C[CASCADE]
    C -->|derived events + lineage| DS[Derived Store]
    DS -->|lineage graph| LG[Lineage Graph]

    DS --> K[KILO]
    K -->|hypotheses| P[ProtoForge PolicyEngine]
    P -->|decision| AG[Action Gate]
    AG --> E[Emission Layer]

    C --> API[GET /events/:id, GET /lineage/:fingerprint]
    API --> Consumers

    subgraph Future Consumers
        PYI[Proto YI]
        BAM[Build a Mind]
        FF[Forge Finder]
        HYVE[Hyve]
    end

    E --> Consumers
```

## Dependency table

| Consumer | Depends on | Direct import / call | Status |
|---|---|---|---|
| Resonate | HYDI Event Gateway | `ExternalAdapter` → `POST /events` | Active |
| Switchboard | HYDI Event Gateway | `HydiAdapter` → `POST /events` | Active |
| HYDI Event Gateway | RAW Ledger Adapter | `src/adapters/raw-ledger.js` → Supabase | Active |
| CASCADE | RAW Ledger Adapter | `src/adapters/ledger-adapter.js` → Supabase `raw_event_ledger` | Active |
| CASCADE | Derived Store | `src/derived-store.js` (local JSON) | Active |
| CASCADE | Lineage Graph | `src/derived-store.js` `LineageGraph` | Active |
| KILO | CASCADE | (planned) consumes derived events | Reserved |
| ProtoForge | KILO output | `lib/protoforge/policy-engine.js` | Active |
| Action Gate | KILO + PolicyEngine | `lib/protoforge/action-gate.ts` | Active |
| Emission | Action Gate | `lib/event-bus/`, `api/events/stream.js` | Active |
| Chat UI | Chat Router | `api/chat/route.js` | Active (legacy stubs) |

## Legacy dependency graph

```mermaid
flowchart LR
    subgraph Legacy
        L1[modules/cascade-event-intake.js]
        L2[modules/cascade-core.js]
        L3[modules/cascade-health-snapshot.js]
        L4[modules/raw-event-ledger.js]
        L5[keeper/policy-engine.js]
        L6[lib/protoforge/replay-engine.ts]
        L7[lib/replay-engine.ts]
    end

    L1 --> C1[compatibility/cascade-legacy.js]
    C1 --> C[protoforge/cascade/]

    L4 --> C2[compatibility/raw-ledger-legacy.js]
    C2 --> R[RAW Ledger Adapter]

    L5 --> C3[compatibility/policy-legacy.js]
    C3 --> P[lib/protoforge/policy-engine.js]
```

## Direction of travel

1. All new consumers must read from `protoforge/cascade/` derived events, not the RAW LEDGER directly.
2. All new producers must write through `protoforge/hydi-gateway/`, not `modules/raw-event-ledger.js`.
3. All policy decisions must use `lib/protoforge/policy-engine.js`.
4. All replay must use `protoforge/cascade/src/replay.js`.
