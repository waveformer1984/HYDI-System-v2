# HEIDI V2 - Single Truth Architecture

> **Status note (2026-07-14):** this document's design is sound and is the
> target shape referenced by `HYDI_KERNEL_ARCHITECTURE_ROADMAP.md`, but its
> literal reference implementation (`modules/heidi-v2-orchestrator.js` and
> siblings) was never wired to a live entry point and has been partly moved
> to `archive/heidi-v2-dormant-pipeline/`. The roadmap recommends building
> the live kernel spine on `kilo/` + `lib/protoforge/` instead, which
> implements the same CASCADE → KILO → ProtoForge shape with real tests.
> Treat this doc as the architectural spec, not as a description of running
> code.

## From Enforcement-Heavy to Traceable Design

HEIDI v2 corrects the fundamental architectural flaw: systems trying to maintain their own truth. Instead, it provides a deterministic pipeline with externally verifiable state.

---

## 🏗️ Architecture Overview

```
[1] INGESTION LAYER
        ↓ (normalizes structure ONLY)
[2] RAW EVENT LEDGER (IMMUTABLE)
        ↓ (read only)
[3] CASCADE (classification ONLY)
        ↓ (classification object)
[4] KILO (analysis ONLY)
        ↓ (hypotheses)
[5] PROTOFORGE (policy ONLY)
        ↓ (decisions)
[6] EMISSION LAYER (communication ONLY)
```

### Golden Rule
**No layer is allowed to perform another layer's job**

---

## 🔑 Key Components

### 1. RAW EVENT LEDGER V2
- **Single Source of Truth** - The only place events are stored
- **Immutable** - Append-only, never modified
- **Hashed** - Content integrity verified
- **READ ONLY** for all other layers

```javascript
// ONLY write operation
const record = await rawEventLedgerV2.append(event);

// All other layers READ from it
const event = rawEventLedgerV2.getById(eventId);
```

### 2. Ingestion Layer V2
- **Dumb Pipes Only** - Normalizes structure, not meaning
- **No Interpretation** - Doesn't classify or analyze
- **Source Agnostic** - Accepts from Vercel, local, Supabase, UI

```javascript
// Only normalizes structure
const normalized = {
  source: 'vercel',
  type: 'error',
  payload: { ... }, // Preserved exactly
  metadata: { ... } // Additional info only
};
```

### 3. CASCADE V2 - Classification Only
- **Input**: Raw ledger events
- **Output**: Classification object only
- **NO side effects** - No routing, no repair, no emission

```javascript
// Output format
{
  event_id: "uuid",
  classification: "INFRA_FAILURE",
  confidence: 0.82,
  matched_rules: ["infrastructure_failure"]
}
```

### 4. KILO V2 - Analysis Only
- **Hypothesis Generator** - Not truth gate
- **Reads**: CASCADE output + RAW LEDGER context
- **NO execution authority** - Only suggests

```javascript
// Output format
{
  hypotheses: ["Service not running", "Resource exhaustion"],
  suggested_fixes: ["Check service status", "Monitor resources"],
  investigation_steps: ["Ping endpoint", "Check logs"]
}
```

### 5. ProtoForge V2 - Policy Engine
- **Decision Layer** - Accept/reject suggestions
- **Prioritizes** based on severity and system load
- **NO direct modifications** - Doesn't bypass layers

```javascript
// Decision process
if (confidence < threshold) reject;
if (rateLimited) reject;
if (priority < threshold && systemLoad > 0.8) reject;
approve();
```

### 6. Emission Layer V2
- **Outward Communication Only** - SSE, API, logs
- **NO logic** - Just emits what it receives
- **Structured format** - Consistent output

### 7. Replay Engine V2
- **Truth Validator** - Ensures determinism
- **Same input → same output** - Or drift is detected
- **Execution traces** - Full pipeline history

---

## 🔄 Event Flow Example

```javascript
// 1. Event arrives
const rawEvent = {
  source: 'vercel',
  type: 'error',
  payload: { error_code: 'ECONNREFUSED' }
};

// 2. Ingestion normalizes structure
const ledgerRecord = await ingestionLayer.ingest(rawEvent);

// 3. CASCADE classifies (automatic)
const classification = await cascade.processEvent(ledgerRecord.id);
// -> { classification: 'INFRA_FAILURE', confidence: 0.9 }

// 4. KILO analyzes (automatic)
const analysis = await kilo.analyzeEvent(ledgerRecord.id, classification);
// -> { hypotheses: [...], suggested_fixes: [...] }

// 5. ProtoForge decides (automatic)
const action = await protoforge.processAnalysis(analysis);
// -> { action_id: '...', approved: true, priority: 10 }

// 6. Emission layer emits (automatic)
await emission.emitAction(action);
// -> Sent to SSE, API, logs
```

---

## 🎯 Key Differences from V1

| Aspect | V1 (Enforcement-Heavy) | V2 (Traceable Design) |
|--------|------------------------|----------------------|
| Truth | Derived states, interpreted | RAW LEDGER (immutable) |
| Layers | Overlapping responsibilities | Explicit, no overlap |
| Validation | Contract guards everywhere | Replay + audit |
| Drift Detection | Assumed from metrics | Actual from replay |
| Repairs | Automatic execution | Hypotheses only |
| Observability | Self-referential | External store |
| Architecture | Fragile autonomy | Production-grade |

---

## 📊 Determinism Verification

The replay engine ensures system reliability:

```javascript
// Replay any event
const result = await replayEngine.replayEvent(eventId);

// Check for drift
if (result.drift_detected) {
  console.warn('System behavior changed!');
}

// Validate entire system
const validation = await replayEngine.validateDeterminism(100);
console.log(`Determinism: ${validation.deterministic_rate}%`);
```

---

## 🔧 Configuration

### System Policies
```javascript
// ProtoForge policies
policies: {
  maxActionsPerMinute: 10,
  priorityWeights: {
    'INFRA_FAILURE': 10,
    'DATA_INTEGRITY_RISK': 9,
    // ...
  },
  requiredConfidence: {
    'INFRA_FAILURE': 0.7,
    'DATA_INTEGRITY_RISK': 0.8,
    // ...
  }
}
```

### Replay Configuration
```javascript
// Replay engine settings
config: {
  batchSize: 100,
  maxConcurrency: 5,
  driftThreshold: 0.01, // 1% difference
  storeReplayHistory: true
}
```

---

## 🚀 Running HEIDI V2

```javascript
// Start the system
await heidiV2Orchestrator.start();

// Ingest events
await heidiV2Orchestrator.ingestEvent(rawEvent, sourceContext);

// Check status
const status = heidiV2Orchestrator.getSystemStatus();

// Validate system
const validation = await heidiV2Orchestrator.validateSystem();

// Stop system
await heidiV2Orchestrator.stop();
```

---

## 🧪 Testing

Run the comprehensive test suite:

```bash
node test-heidi-v2.js
```

Tests demonstrate:
- Single truth architecture
- Explicit layer separation
- Deterministic replay
- Policy decisions
- External observability

---

## 📈 Benefits

1. **Debuggable** - Full execution traces for every event
2. **Reliable** - Deterministic behavior verified
3. **Observable** - External truth, no self-reference
4. **Maintainable** - Clear layer responsibilities
5. **Scalable** - No enforcement bottlenecks

---

## 🎭 What HEIDI V2 is NOT

- ❌ Self-healing AI system
- ❌ Autonomous orchestration engine
- ❌ Enforcement-heavy with guards everywhere
- ❌ System that maintains its own truth

---

## 🎭 What HEIDI V2 IS

- ✅ Deterministic event pipeline
- ✅ Traceable reasoning with replay
- ✅ Externally verifiable state
- ✅ Production-grade architecture
- ✅ System whose truth can always be reconstructed

---

## 🔮 Future Evolution

The next evolution isn't more modules - it's a visual trace debugger that lets you watch system reasoning like a timeline instead of reading logs like archaeology.

---

## 💡 The Critical Insight

> The difference between fragile autonomy theater and production-grade architecture is whether the system's truth can be reconstructed externally.

HEIDI V2 achieves this through:
1. **RAW LEDGER** - Immutable truth anchor
2. **Explicit Layers** - No overlap, clear responsibilities  
3. **Replay Engine** - Truth validator
4. **External Observability** - No self-reference

This is the foundation for systems that don't just feel stable - they ARE stable.
