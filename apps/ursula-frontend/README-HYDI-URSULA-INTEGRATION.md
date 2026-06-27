# HYDI + URSULA INTEGRATION

## ARCHITECTURE DECISION: ONE EXECUTION PATH

**HYDI = Control Logic**  
**Ursula = Execution + Billing**

Not two systems. One brain, one body.

---

## EXECUTION FLOW

```text
HYDI (intent + task planning)
    |
    v
Atomic Governance Layer (HYDI)
    |
    v
Ursula Bridge (delegate execution)
    |
    v
Ursula Execution Engine
    |
    v
Billing + Ledger (Ursula)
    |
    v
Result -> HYDI -> User
```

---

## CRITICAL RULES

### HYDI MUST NOT:
- Execute tasks directly
- Calculate costs
- Handle billing
- Track revenue
- Bypass Ursula

### URSULA MUST:
- Handle all execution
- Enforce billing
- Manage state machines
- Provide survivability
- Handle failures and refunds

---

## API ENDPOINTS

### HYDI Task Management
- `POST /api/hydi/tasks/create` - Create task with governance validation
- `GET /api/hydi/tasks/:id` - Get task with Ursula integration data
- `PATCH /api/hydi/tasks/:id` - Atomic task updates with governance
- `POST /api/hydi/tasks/:id/execute` - Execute task through Ursula ONLY

### Ursula Execution
- `POST /api/execute` - Main execution endpoint (survivable)
- `POST /api/billing/create-intent` - Payment intent creation
- `POST /api/billing/webhook` - Stripe webhook processing
- `GET /api/user/status` - User credits and subscription status

---

## TASK TRACEABILITY

Every HYDI task maps to Ursula execution:

```typescript
{
  task_id: "hydi-task-123",
  // HYDI fields
  title: "Generate audio metadata",
  status: "completed",
  
  // Ursula integration fields
  ursula_execution_id: "ursula-exec-456",
  ursula_ledger_entry_id: "ledger-789",
  ursula_payment_intent_id: "pi_abc123",
  ursula_execution_state: "COMPLETED",
  ursula_cost: 2,
  billing_status: "paid"
}
```

---

## ATOMIC GOVERNANCE

### States
- `pending` -> `queued` -> `running` -> `completed`/`failed`
- Terminal states: `completed`, `hard_failed`
- Retry states: `retrying`, `resolving`

### Budget Enforcement
- Max retries: 3
- Max fix attempts: 3
- DLQ on budget exhaustion

### Version Control
- `state_version` required for all updates
- Optimistic locking prevents conflicts

---

## SURVIVABILITY FEATURES

### Ursula Handles:
- Idempotency (prevent duplicate charges)
- State machine enforcement
- Webhook deduplication
- Failure handling with refunds
- Request tracing and observability
- Abuse prevention and rate limiting

### HYDI Handles:
- Task planning and validation
- Atomic governance
- State consistency
- User interface

---

## ENVIRONMENT VARIABLES

```env
# Ursula Platform
URSULA_API_URL=http://localhost:3000
URSULA_API_KEY=your-api-key

# HYDI System
REDIS_URL=your-redis-url
USE_DUAL_WRITE=true
```

---

## TESTING THE INTEGRATION

### 1. Create Task
```bash
curl -X POST http://localhost:3001/api/hydi/tasks/create \
  -H "Content-Type: application/json" \
  -H "x-user-id: user-123" \
  -d '{
    "title": "Test Resonate Task",
    "system": "music_ai",
    "type": "build",
    "inputs": {"prompt": "test audio"}
  }'
```

### 2. Execute Task
```bash
curl -X POST http://localhost:3001/api/hydi/tasks/[task-id]/execute \
  -H "x-user-id: user-123"
```

### 3. Check Result
```bash
curl http://localhost:3001/api/hydi/tasks/[task-id]
```

---

## FAILURE SCENARIOS

### Payment Success + Execution Failure
- Ursula automatically refunds
- HYDI task marked as `failed`
- Retry allowed if budget permits

### Webhook Delays/Duplicates
- Ursula handles idempotently
- HYDI state remains consistent
- No duplicate charges

### Network Failures
- Idempotency prevents double execution
- State recovery on restart
- Traceability for debugging

---

## MONITORING

### Key Metrics
- Task execution success rate
- Payment success rate
- Average execution time
- Retry frequency
- Failed task analysis

### Alerts
- High failure rates
- Payment processing issues
- Unusual retry patterns
- System performance degradation

---

## NEXT STEPS

1. **Test end-to-end flow** with real tasks
2. **Monitor integration** for consistency issues
3. **Optimize performance** based on usage patterns
4. **Scale horizontally** if needed
5. **Add more modules** through Ursula (not HYDI)

---

## REMINDER

**One execution path. One system that touches money every time.**

This is how we avoid building two impressive systems that don't actually work together.
