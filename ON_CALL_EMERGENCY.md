# ON-CALL EMERGENCY RUNBOOK
**For 3am brain state - yes/no decisions only**

---

## WEBHOOK EMERGENCIES

### CPU > 80%?
```
YES: WEBHOOK_PROCESSING_ENABLED=false
NO: Check duplicate rejection rate
```

### Duplicate rejection rate > 5%?
```
YES: Rollback webhook deployment
NO: Check API error rate
```

### API error rate > 10%?
```
YES: Check database locks
NO: Monitor 15 minutes
```

### Database locks on customer_services?
```
YES: Drop GIN index (idx_cs_metadata)
NO: Check pg_locks for root cause
```

---

## SERVICE PROVISIONING

### < 10 customers affected?
```
YES: Manual provisioning
NO: Replay webhook events
```

### Service provisioning failures > 10%?
```
YES: Rollback recent changes
NO: Monitor next 5 events
```

---

## REVENUE ISSUES

### Revenue discrepancy < $100?
```
YES: Manual fix single transaction
NO: Full revenue audit
```

### Missing revenue tracking?
```
YES: Check webhook_events table
NO: Escalate to finance
```

---

## CRITICAL ALERTS

### RED ALERTS (IMMEDIATE)
- Duplicate rejection rate > 5%
- RLS disabled
- > 5 customer complaints

### ORANGE ALERTS (15 MINUTES)
- API error rate > 5%
- Provisioning failures > 10%
- DB lock timeouts

### YELLOW ALERTS (1 HOUR)
- CPU > 80% > 5 minutes
- Memory > 90%
- Index rebuild needed

---

## EMERGENCY ACTIONS

### KILL SWITCH
```
WEBHOOK_PROCESSING_ENABLED=false
```

### EMERGENCY DB ACCESS
```
ALTER TABLE webhook_events DISABLE ROW LEVEL SECURITY;
```

### INDEX EMERGENCY
```
DROP INDEX CONCURRENTLY idx_cs_metadata;
```

---

## RECOVERY CHECKLIST

### After any incident:
- [ ] WEBHOOK_PROCESSING_ENABLED=true
- [ ] RLS re-enabled
- [ ] Verification passes
- [ ] Monitor 30 minutes
- [ ] Document cause

---

## ESCALATE IF:

- Revenue impact > $500
- Customer impact > 50 users
- Downtime > 5 minutes
- Security incident

---

**WHEN IN DOUBT: KILL SWITCH FIRST**
