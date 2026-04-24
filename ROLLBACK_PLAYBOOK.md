# PRODUCTION ROLLBACK PLAYBOOK

## EMERGENCY KILL SWITCH
**Environment Variable: `WEBHOOK_PROCESSING_ENABLED=false`**

### Immediate Actions
1. Set `WEBHOOK_PROCESSING_ENABLED=false` in environment
2. All webhook requests return `200 paused` 
3. Monitor logs to confirm suppression is active
4. No thinking. No debate. Flip it and breathe.

## CONTROLLED ROLLBACK SEQUENCE

### Phase 1: Immediate Containment
```sql
-- Disable webhook processing (application level)
-- WEBHOOK_PROCESSING_ENABLED=false

-- Emergency database access if needed
ALTER TABLE public.webhook_events DISABLE ROW LEVEL SECURITY;
```

### Phase 2: Safe Constraint Removal (ORDER MATTERS)
```sql
-- Drop FK constraints FIRST (prevents dependency issues)
ALTER TABLE public.customer_services DROP CONSTRAINT IF EXISTS customer_services_customer_id_fkey;
ALTER TABLE public.revenue_tracking DROP CONSTRAINT IF EXISTS revenue_tracking_customer_id_fkey;

-- Then drop UNIQUE/CHECK constraints
ALTER TABLE public.customer_services DROP CONSTRAINT IF EXISTS customer_services_unique;
```

### Phase 3: Index Triage Rules
**Decision Tree:**
- **High CPU/write latency spike** -> Drop GIN index first (metadata)
- **Read slowdown only** -> Keep indexes, don't panic-drop
- **Lock contention** -> Check `pg_locks` before dropping anything

```sql
-- Emergency index drops (use triage logic above)
DROP INDEX CONCURRENTLY IF EXISTS idx_cs_metadata; -- GIN index (high write cost)
-- Other indexes only after triage
```

### Phase 4: Data Recovery (PREFER FORWARD REPAIR)
**Default to repair-forward:**
1. Reprocess affected webhook events
2. Patch specific bad rows
3. Replay missing records
4. **Full restore = LAST RESORT ONLY** (causes downtime + lost writes)

### Phase 5: RLS Recovery (MANDATORY)
```sql
-- CRITICAL: Must re-enable RLS after emergency access
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- Record in incident notes: timestamp + owner
```

## CRITICAL METRICS TO MONITOR

### During Incident
- Webhook ingestion rate
- API error rate  
- Database locks
- **Duplicate webhook rejection rate** (NEW - indicates idempotency failure)

### Alert Thresholds
- Duplicate rejection rate > 1% -> Idempotency broken
- API error rate > 5% -> System degradation
- DB lock wait time > 100ms -> Contention issues

## RECOVERY VERIFICATION

### Post-Rollback Checks
```sql
-- Run verification checklist
SELECT 'customer_services null customer_id' as check_name, COUNT(*) as count
FROM customer_services WHERE customer_id IS NULL;

-- Verify no orphaned records
SELECT 'customer_services orphans' as check_name, COUNT(*) as count
FROM customer_services cs
LEFT JOIN customers c ON cs.customer_id = c.id
WHERE c.id IS NULL;

-- Check for duplicates
SELECT 'duplicate services' as check_name, COUNT(*) as count
FROM (
  SELECT customer_id, service_name, COUNT(*) as cnt
  FROM customer_services
  GROUP BY customer_id, service_name
  HAVING COUNT(*) > 1
) duplicates;
```

## INCIDENT RESPONSE DECISION TREE

### Situation: Webhook Processing Overload
```
Is CPU > 80%? 
  YES: Set WEBHOOK_PROCESSING_ENABLED=false
  NO: Check duplicate rejection rate
```

### Situation: Database Lock Contention
```
Are locks on customer_services? 
  YES: Drop GIN index first
  NO: Check pg_locks for root cause
```

### Situation: Data Corruption Detected
```
Are < 100 rows affected?
  YES: Patch specific rows
  NO: Replay webhook events
```

## ESCALATION TRIGGERS

### Immediate Escalation
- Duplicate webhook rejection rate > 5%
- Database lock timeout errors
- Customer service complaints about missing services

### Emergency Escalation
- Revenue tracking discrepancies
- Service provisioning failures > 10%
- RLS accidentally left disabled

## POST-INCIDENT ACTIONS

1. **Root Cause Analysis** - Why did rollback happen?
2. **Procedure Review** - Update playbook based on lessons learned
3. **Monitoring Enhancement** - Add missing alerts
4. **Testing** - Verify rollback procedures work
5. **Documentation** - Update runbooks with new scenarios

---

**Remember: The only time you'll need this is the exact moment your brain decides to stop working. Keep it visible.**
