# Heidi Execution Audit

## Recorded Fields

Each audit entry records:

- `timestamp`
- `taskId`
- `capabilityId`
- `actor`
- `target`
- `inputs` (redacted)
- `approvalState`
- `executionResult`
- `verificationResult`
- `duration`
- `error`
- `resultingState`

## Redaction

Inputs are redacted by the `SecretBroker` before storage. Secret-shaped strings and JWTs become `[REDACTED]`. Object keys matching `/secret|key|token|password|credential/i` become `[REDACTED]`.

## Querying

```js
const { HeidiExecutive } = require('./src/heidi-executive');
const heidi = new HeidiExecutive();
heidi.audit.query({ capabilityId: 'health.read', actor: 'owner' });
```

## Security

- No raw credential is written to the audit log.
- Audit log is currently in-memory. Persistence can be added via Supabase `audit_log` table.
