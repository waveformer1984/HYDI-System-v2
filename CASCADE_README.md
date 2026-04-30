# CASCADE - Strict Event Processing System

## Core Principle

CASCADE does NOT "decide reality." It only does three things:
1. **Detect** - Normalizes incoming signals
2. **Classify** - Assigns specific labels
3. **Emit** - Sends structured events

No self-deployment. No evolution. It reacts.

## Architecture

### 1. Event Intake Layer
All incoming signals are normalized into this format:
```json
{
  "source": "vercel | local | supabase | user | system",
  "type": "error | warning | info | heartbeat | request",
  "payload": {},
  "timestamp": "ISO-8601"
}
```

If it's not in this format → CASCADE ignores it.

### 2. Validation Gate
Every event must pass:
- Must have type
- Must have source  
- Must have non-empty payload
- Must not be duplicate within 5 seconds

Failed validation:
```json
{
  "event": "cascade_event_rejected",
  "reason": "validation_failed",
  "action": "quarantine"
}
```

### 3. Classification Engine
CASCADE only assigns these labels:
- **INFRA_FAILURE** - Module not found, connection refused
- **ROUTE_FAILURE** - 4xx/5xx HTTP errors
- **DEPLOYMENT_MISMATCH** - Missing env vars, version conflicts
- **DATA_INTEGRITY_RISK** - Corruption, checksum mismatch
- **STREAM_BREAK** - WebSocket disconnect, connection lost
- **UNKNOWN_ANOMALY** - Everything else

Example output:
```json
{
  "event": "hyve_opportunity_detected",
  "classification": "INFRA_FAILURE",
  "confidence": 0.87
}
```

### 4. Decision Tree
Strict routing based on classification:

**IF INFRA_FAILURE** → emit repair manifest
**IF STREAM_BREAK** → restart stream + log reconnection
**IF DEPLOYMENT_MISMATCH** → compare env vars + trigger audit
**IF UNKNOWN_ANOMALY** → quarantine + manual review

### 5. Repair Manifest Generator
CASCADE does NOT execute fixes. It proposes them:
```json
{
  "event": "repair_manifest_generated",
  "target": "module_name",
  "issue": "MODULE_NOT_FOUND",
  "steps": [
    "verify_imports",
    "check_env_vars",
    "restore_dependency",
    "restart_service"
  ],
  "priority": "high"
}
```

### 6. Emission Layer
Connects to external systems:
- **Ursula** - SSE stream broadcasting
- **Dashboard** - UI updates
- **Backend** - Command execution
- **Hyve** - Opportunity forwarding

### 7. Quarantine System
Critical safety boundary:
- Repeated failures
- Unknown schema events
- Broken stream loops

No auto-retry loops without limit. That's how systems spiral.

### 8. Heartbeat System
CASCADE emits every 20 seconds:
```json
{
  "event": "cascade_heartbeat",
  "status": "alive",
  "active_modules": ["intake", "emission", "quarantine"]
}
```

If heartbeat stops → system is degraded.

## API Endpoints

### Get System Status
```
GET /cascade/status
```

Returns:
- Running status
- Event statistics
- System health
- Component status

### Process Event
```
POST /cascade/event
{
  "source": "local",
  "event": {
    "type": "error",
    "payload": { ... }
  }
}
```

### View Quarantine
```
GET /cascade/quarantine?limit=50
```

### Manual Release
```
POST /cascade/quarantine/:eventId/release
{
  "approved_by": "operator_name"
}
```

## Minimal Execution Flow

```
INGEST EVENT
→ VALIDATE
→ CLASSIFY
→ ROUTE DECISION
→ EMIT RESULT
→ LOG STATE
→ WAIT NEXT EVENT
```

That's it. No extra mythology needed.

## Integration

The system is already integrated with:
- ProtoForge Event Bus
- Heidi Contextual Conscience
- Ursula SSE Stream
- Infrastructure monitoring

## Testing

Run the test suite:
```bash
node test-cascade-system.js
```

This demonstrates:
- Infrastructure failure detection
- Stream break handling
- Deployment mismatch alerts
- Unknown anomaly quarantine
- Duplicate event rejection
- Heartbeat monitoring
- Manual quarantine release

## Key Rules

1. **NO INTERPRETATION LAYER** - CASCADE doesn't guess reality
2. **ZERO-FABRICATION** - No invented entities or metrics
3. **TRACEABLE OUTPUTS** - Every action has a source
4. **AUTO-FAIL MODE** - Missing data = HALT
5. **FAILURE OVER SUCCESS** - Prefer empty results over fake ones

## The Truth

CASCADE is a boringly deterministic event classifier.
It tells you when things are broken.
It doesn't pretend to fix them.

That's the point.
