# CASCADE V2 - Enhanced Strict Event Processing System

## Core Principle (Unchanged)

CASCADE does NOT "decide reality." It only does three things:
1. **Detect** - Normalizes incoming signals
2. **Classify** - Assigns specific labels  
3. **Emit** - Sends structured events

No self-deployment. No evolution. It reacts.

## V2 Enhancements

### 1. Schema Lock Enforcement
- **Immutable schema validation** with SHA-256 hash
- Rejects any event not matching canonical format exactly
- No implicit field inference
- Caches validation results for performance

```json
{
  "event_id": "uuid-v4-required",
  "source": "vercel|local|supabase|user|system",
  "type": "error|warning|info|heartbeat|request", 
  "payload": {"minKeys": 1},
  "timestamp": "ISO-8601-required",
  "schema_hash": "a1b2c3d4..."
}
```

### 2. Event Fingerprint System
- **SHA-256 fingerprinting** of normalized payloads
- **15-second TTL cache** for duplicate detection
- Sliding window prevents duplicate storms
- Rejects duplicates BEFORE classification

### 3. Confidence Scoring for All Adapters
- Every adapter calculates confidence (0.0-1.0)
- Source reliability factors (system=1.0, user=0.7)
- Automatic quarantine for confidence < 0.75
- Tracks confidence distribution by source

### 4. Hard Classification Boundaries
- **Strict enum validation only** - 6 categories allowed
- No fuzzy matching or semantic drift
- Unknown anomalies = immediate quarantine
- Pattern matching must be EXACT

### 5. System Health Snapshot Engine
- Real-time metrics every **10 seconds**
- Active streams, throughput, error ratio
- Quarantine growth rate tracking
- Component health monitoring
- Exposed via `/cascade/health`

### 6. Emission Acknowledgment Tracking
- **Requires ACK from all targets** (Ursula, Dashboard, Backend, Hyve)
- Retry counters with exponential backoff
- Per-event delivery state tracking
- Failure logs and retry statistics

### 7. Dead-Letter Finality
- Events exceeding **5 retries** go to dead-letter storage
- Permanent disk storage (`data/dead-letters.json`)
- Excluded from retry loops
- Manual review required

## Architecture V2

```
INGEST EVENT
→ SCHEMA LOCK (hash validation)
→ FINGERPRINT (duplicate check)
→ ADAPTER (confidence scoring)
→ CONFIDENCE CHECK (<0.75 = quarantine)
→ HARD CLASSIFICATION (enum only)
→ DECISION ROUTING
→ EMISSION (with ACK tracking)
→ DEAD LETTER (after 5 retries)
```

## API Endpoints V2

### Core Endpoints
- `GET /cascade/status` - Full system status
- `POST /cascade/event` - Process event
- `GET /cascade/quarantine` - View quarantine
- `POST /cascade/quarantine/:eventId/release` - Manual release

### V2 Enhanced Endpoints
- `GET /cascade/health` - Real-time health report
- `GET /cascade/dead-letters` - View dead-lettered events
- `GET /cascade/emissions` - Emission tracking report
- `GET /cascade/schema` - Schema lock information
- `GET /cascade/fingerprint` - Fingerprint statistics

## Processing Flow V2

### Valid Event Path
1. Adapter normalizes with confidence score
2. Schema lock validates with hash check
3. Fingerprint system blocks duplicates
4. Confidence check passes (>0.75)
5. Hard classification matches known pattern
6. Decision routed to appropriate handler
7. Emission sent with ACK tracking
8. Success or retry logic applied

### Rejection Paths
- **Schema violation** → Immediate discard
- **Duplicate fingerprint** → Immediate discard  
- **Low confidence** → Quarantine
- **Unknown anomaly** → Quarantine
- **Max retries exceeded** → Dead letter

## Statistics V2

Enhanced tracking includes:
- Schema violations count
- Duplicate blocks count
- Low confidence blocks count
- Dead-lettered events count
- Emission success/failure rates
- Confidence distribution by source
- Retry statistics by target

## Testing

Run V2 test suite:
```bash
node test-cascade-v2.js
```

Demonstrates:
- Schema lock enforcement
- Fingerprint duplicate detection
- Confidence scoring
- Hard classification boundaries
- Health snapshot monitoring
- Emission acknowledgment tracking
- Dead letter finality

## Key Rules V2 (All V1 Rules +)

1. **SCHEMA IMMUTABILITY** - No field inference, exact match required
2. **DUPLICATE PREVENTION** - Fingerprint blocks at ingestion
3. **CONFIDENCE GATING** - <0.75 = automatic quarantine
4. **ENUM CLASSIFICATION** - Only 6 allowed categories
5. **ACK REQUIREMENT** - All emissions must be acknowledged
6. **DEAD LETTER FINALITY** - 5 retries = permanent storage

## The Truth V2

CASCADE V2 is still a boringly deterministic event classifier.
But now it's:
- **Stricter** - No "almost valid" events
- **Safer** - No duplicate storms
- **Smarter** - Confidence-based filtering
- **Observable** - Real-time health metrics
- **Reliable** - Acknowledgment tracking
- **Final** - Dead letters prevent infinite loops

It still doesn't pretend to fix things.
It just tells you more precisely when they're broken.
