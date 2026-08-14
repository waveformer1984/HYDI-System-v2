# Heidi Approval Model

## Approval Record

Each approval request captures:

- `taskId`
- `capabilityId`
- `requestedAction`
- `target`
- `risk`
- `proposedParameters`
- `expectedSideEffects`
- `rollbackProcedure`
- `requester`
- `approver`
- `requestedAt`
- `decidedAt`
- `decision` (`PENDING` | `APPROVED` | `REJECTED` | `EXPIRED`)
- `expiration`

## Rules

1. The model (`heidi`) can request any action it is authorized to request.
2. The model may NOT approve its own CRITICAL actions.
3. Approval records expire after one hour by default.
4. Rejected or expired approvals cannot be executed.
5. Execution of an approved task requires `approval: true` on the task.

## API

```js
const heidi = new HeidiExecutive();
const result = await heidi.run({ id: 't1', capabilityId: 'deploy.production', parameters: {} });
// result.status === 'AWAITING_APPROVAL'

heidi.approve('t1', 'owner');
await heidi.executeApproved({ id: 't1', capabilityId: 'deploy.production' }, { id: 'owner' });
```
