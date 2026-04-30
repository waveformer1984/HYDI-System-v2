# ON-CALL RUNBOOK - INCIDENT DECISION TREE

## WEBHOOK EMERGENCIES

### High CPU/Load?
```
WEBHOOK_PROCESSING_ENABLED=false
Monitor: CPU < 60% for 2 minutes
```

### Duplicate Events Spiking?
```
Check: claim_webhook_event RPC function
Rollback: Recent webhook deployment
Alert: Finance team (money duplication risk)
```

### Database Locks?
```
Check: pg_locks for customer_services
Action: Drop GIN index if write locks
Triage: Don't drop read indexes
```

## SERVICE PROVISIONING FAILURES

### < 10 customers affected?
```
Action: Manual service provisioning
Fix: Specific customer records
Monitor: Error rate < 1%
```

### > 10 customers affected?
```
Action: Replay webhook events
Rollback: Recent provisioning changes
Escalate: Engineering lead
```

## REVENUE DISCREPANCIES

### < $100 difference?
```
Action: Manual revenue tracking fix
Check: Single webhook event
Monitor: Next 10 payments
```

### > $100 difference?
```
Action: Revenue audit
Rollback: Payment processing changes
Escalate: Finance + Engineering
```

## CRITICAL ALERTS

### RED ALERTS (Immediate response)
- Duplicate webhook rejection rate > 5%
- RLS accidentally disabled
- Customer service > 5 complaints

### ORANGE ALERTS (15-minute response)
- API error rate > 5%
- Service provisioning failures > 10%
- Database lock timeouts

### YELLOW ALERTS (1-hour response)
- CPU > 80% for > 5 minutes
- Memory usage > 90%
- Index rebuild needed

## RECOVERY CHECKLIST

### After Any Incident
- [ ] WEBHOOK_PROCESSING_ENABLED=true
- [ ] RLS re-enabled on all tables
- [ ] Verification checklist passes
- [ ] Monitor for 30 minutes
- [ ] Document root cause

### Escalation Required?
- Revenue impact > $500
- Customer impact > 50 users
- System downtime > 5 minutes
- Security incident detected

---

**When in doubt: KILL SWITCH FIRST, ask questions later.**
