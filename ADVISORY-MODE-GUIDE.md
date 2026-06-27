# HEIDI Advisory Mode — Trustworthy Autonomous Operation

## Overview

**Advisory Mode** transforms HEIDI from autonomous execution to a **recommend-then-approve** model where every decision is reviewed before action.

```
User Query/Task
      ↓
HEIDI Analyzes (with procedural memory)
      ↓
HEIDI Recommends Verdict
      ↓
Human Approves/Rejects
      ↓
HEIDI Executes (if approved)
```

## Why Advisory Mode?

The three critical agent safety fixes ensure HEIDI makes sound decisions:

1. **Lease Claim Fixed** — Prevents concurrent task execution conflicts
2. **Confidence Gate Restored** — Doesn't boost confidence before evaluation
3. **Sensitive Task Routing** — All financial/crypto/vendor tasks forced to REVIEW

**But even with these fixes, executing autonomously is risky.** Advisory Mode gives humans final say while letting HEIDI recommend intelligently.

## Architecture

### Decision Verdicts

HEIDI's decision logic produces three verdicts:

- **AUTO-APPROVE**: High confidence (≥85%), within bounds, non-sensitive
- **REVIEW**: Low confidence, sensitive (financial/crypto/vendor), or out of bounds
- **BLOCK**: Very low confidence (<50%), dangerous

**In Advisory Mode**: AUTO-APPROVE verdicts also route to REVIEW (user can skip if confident)

### HTTP API (Port 3459)

When started with `HEIDI_ADVISORY_MODE=true`, HEIDI opens advisory API:

```bash
# List all pending tasks awaiting approval
GET http://localhost:3459/api/decisions/pending

# Approve and execute a task
POST http://localhost:3459/api/decisions/{taskId}/approve

# Reject a task (with optional reason)
POST http://localhost:3459/api/decisions/{taskId}/reject
Content-Type: application/json
{ "reason": "Risky timing" }
```

### Response Format

```json
{
  "decision": [
    {
      "task_id": "f52d558a-1682-4655-b571-e5aa6200213d",
      "type": "financial_approval",
      "division": "financial",
      "payload": { "amount": 5000, "recipient": "vendor" },
      "confidence": 0.92,
      "decision": {
        "verdict": "REVIEW",
        "reason": "Sensitive (financial) → human approval required"
      }
    }
  ]
}
```

## Starting HEIDI in Advisory Mode

### Option 1: Environment Variable

```powershell
cd C:\Users\Owner\HYDI-System-v2\heidi-core
$env:HEIDI_ADVISORY_MODE = 'true'
node heidi-agent.js
```

### Option 2: Direct Execution

```powershell
cd C:\Users\Owner\HYDI-System-v2
HEIDI_ADVISORY_MODE=true node heidi-core/heidi-agent.js
```

### Option 3: Chat Server (Mobile UI)

Start the chat server with advisory mode support:

```powershell
cd C:\Users\Owner\HYDI-System-v2
node launch-heidi-mobile.js
```

Then use the advisory UI (see next section).

## User Interface

### Mobile Chat UI (Port 3006)

The chat interface shows:

- ✅ **Grounded responses** — Facts marked with 📚 emoji badge
- 🤔 **Pending decisions** — Tasks awaiting approval in sidebar
- ⚙️ **Controls** — Approve/Reject buttons for each decision

Example workflow:

1. You ask Heidi: *"Approve the $5k vendor payment to Acme Corp"*
2. Heidi analyzes using procedural memory → Verdict: REVIEW (financial task)
3. Heidi shows recommendation: *"Task has high confidence (92%) and is within monthly bounds. Recommend: APPROVE"*
4. You click ✅ APPROVE → Task executes
5. Heidi logs decision to `heidi_events` table

### Advisory Control Panel (Port 3459)

For programmatic access or custom UI:

```javascript
// List pending decisions
const decisions = await fetch('http://localhost:3459/api/decisions/pending').then(r => r.json());

// Approve a task
await fetch(`http://localhost:3459/api/decisions/${taskId}/approve`, { method: 'POST' });

// Reject with reason
await fetch(`http://localhost:3459/api/decisions/${taskId}/reject`, {
  method: 'POST',
  body: JSON.stringify({ reason: 'Timing too risky' })
});
```

## Grounded Chat Mode

Both advisory mode and autonomous operation use **grounded chat** with procedural memory:

### System Prompt

```
You are Heidi, the AI assistant for the HYDI ProtoForge system.
CRITICAL: Answer ONLY using the facts provided below. Do not invent, assume, or extrapolate.
If the facts don't contain information relevant to the question, say so clearly.
```

### Temperature

Reduced to 0.2 (vs. default 0.7) to minimize hallucination and confabulation.

### Fact Retrieval

Before each chat response, HEIDI:

1. Embeds your query via Ollama `nomic-embed-text`
2. Searches procedural memory (pgvector cosine similarity)
3. Retrieves top 5 facts at 0.6+ similarity threshold
4. Injects facts into system prompt before inference

**Result**: Responses are grounded in verified system facts, not invented details.

## Example: Financial Task Flow

### Scenario: $5k Vendor Payment

1. **Task Created**
   ```json
   {
     "type": "financial_approval",
     "division": "financial",
     "payload": { "amount": 5000, "recipient": "Acme Corp" },
     "confidence": 0.92
   }
   ```

2. **HEIDI Analyzes**
   - Retrieves facts: vendor limits (monthly max $10k), approval history
   - Evaluates: "This is financial (sensitive) → REVIEW required"
   - Verdict: "REVIEW — Sensitive (financial) → human approval required"

3. **User Approves**
   - POST `/api/decisions/{taskId}/approve`
   - HEIDI executes financial transaction
   - Logs to `heidi_events`: verdict=AUTO-APPROVE, memory_ids=[fact1, fact3, ...]

4. **Reflection**
   - Hourly cycle analyzes last 20 decisions
   - Learns patterns: "100% of financial approvals required human review"
   - Stores insights in `heidi_reflections`

## Safety Guarantees in Advisory Mode

| Risk | Mitigation | Status |
|------|-----------|--------|
| Concurrent execution | Lease-based mutual exclusion (120s TTL) | ✅ Fixed |
| Confidence self-boost | Evaluate gates on original confidence | ✅ Fixed |
| Sensitive tasks auto-execute | Force financial/crypto/vendor to REVIEW | ✅ Fixed |
| Confabulation | Stricter prompt + temp 0.2 + fact injection | ✅ Implemented |
| Unapproved execution | Advisory mode requires human approval | ✅ New |

## Monitoring & Auditing

All decisions logged to `heidi_events`:

```sql
SELECT * FROM heidi_events
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

Fields:
- `task_id`: Identifier of executed task
- `verdict`: AUTO-APPROVE / REVIEW / BLOCK / USER-APPROVED / USER-REJECTED
- `reason`: Human-readable decision rationale
- `memory_ids`: IDs of facts that informed the decision
- `context_snapshot`: Full decision context for audit trail
- `timestamp`: When decision was made

## Transitioning to Autonomous Mode

Once you've validated HEIDI's judgment across many advisory-approved decisions:

1. Monitor decision patterns in `heidi_reflections`
2. Confirm confidence thresholds are appropriate
3. Set `HEIDI_ALLOW_EXEC=true` to enable AUTO-APPROVE execution
4. Keep advisory mode available as fallback

**Key insight**: Advisory mode lets HEIDI's reasoning shine while you maintain control. It's not slower—it's *transparent*.

---

**Status**: Advisory Mode ✅ Ready (0.2 Confidence Gate, Grounded Chat, API Live)

**Next Steps**:
1. Deploy advisory UI to Heidi (Tailscale) at https://heidi-pc.tailc50af2.ts.net
2. Test with real workflow: task → recommendation → approval
3. Monitor decision accuracy over 7 days
4. Document patterns in weekly reflection reports
