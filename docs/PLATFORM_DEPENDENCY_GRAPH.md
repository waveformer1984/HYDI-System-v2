# Platform Dependency Graph

## Canonical data flow

```mermaid
flowchart TB
    subgraph Producers
        RES[Resonate]
        SW[Switchboard]
        URS[Ursula / Chat UI]
    end

    RES -->|@protoforge/event-contracts| G[HYDI Event Gateway]
    SW -->|@protoforge/event-contracts| G
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

    CAP[@protoforge/capability-registry] -.metadata.-> RES
    CAP -.metadata.-> SW
    CAP -.metadata.-> G
    CAP -.metadata.-> C
    CAP -.metadata.-> K
    CAP -.metadata.-> P

    C --> API[GET /events/:id, GET /lineage/:fingerprint, GET /api/platform/diagnostics]
    API --> Consumers

    subgraph Future Consumers
        PYI[Proto YI]
        BAM[Build a Mind]
        FF[Forge Finder]
        HYVE[Hyve]
    end

    E --> Consumers
```

## New packages

| Package | Consumers | Purpose |
|---|---|---|
| `@protoforge/event-contracts` | Resonate, Switchboard, all future producers | Shared envelope, fingerprint, hash, metadata |
| `@protoforge/capability-registry` | Diagnostics, all future producers | Capability, producer/consumer, requirement registry |

## Dependency table

| Consumer | Depends on | Direct import / call | Status |
|---|---|---|---|
| Resonate | `@protoforge/event-contracts` | (planned) | Active |
| Resonate | `@protoforge/capability-registry` | (planned) | Active |
| Switchboard | `@protoforge/event-contracts` | (planned) | Active |
| Switchboard | `@protoforge/capability-registry` | (planned) | Active |
| HYDI Event Gateway | RAW Ledger Adapter | `src/adapters/raw-ledger.js` → Supabase | Active |
| CASCADE | RAW Ledger Adapter | `src/adapters/ledger-adapter.js` → Supabase `raw_event_ledger` | Active |
| CASCADE | Derived Store | `src/derived-store.js` | Active |
| CASCADE | Lineage Graph | `src/derived-store.js` `LineageGraph` | Active |
| KILO | CASCADE | (planned) consumes derived events | Reserved |
| ProtoForge | KILO output | `lib/protoforge/policy-engine.js` | Active |
| Action Gate | KILO + PolicyEngine | `lib/protoforge/action-gate.ts` | Active |
| Emission | Action Gate | `lib/event-bus/`, `api/events/stream.js` | Active |
| Diagnostics | Capability Registry | `lib/platform-diagnostics.js` | Active |

## Platform test dependencies

```mermaid
flowchart LR
    subgraph Validation
        EC[@protoforge/event-contracts]
        CR[@protoforge/capability-registry]
        PT[protoforge/tests/platform/]
    end

    EC --> PT
    CR --> PT
    PT -->|uses| C[CASCADE]
    PT -->|uses| G[HYDI Gateway]
    PT -->|uses| K[KILO]
    PT -->|uses| PE[PolicyEngine]
```
