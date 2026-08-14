# Heidi Permission Model

## Actors

- `heidi` — the executive agent; may request but not approve critical actions.
- `owner` — human operator; can approve any action.
- `service` — an internal service account.
- `readonly` — may only invoke READ capabilities.

## Permission Rules

1. Every capability declares `requiredPermissions`.
2. An actor must hold every required permission for the capability.
3. A matching target is required if `allowedTargets` is non-empty.
4. Approval overrides only the approval gate; permission still required.

## Examples

```js
const { CapabilityRegistry, PolicyEngine } = require('./src/heidi-executive');
const reg = new CapabilityRegistry();
const policy = new PolicyEngine(reg);

policy.evaluate(
  { capabilityId: 'health.read', target: 'local' },
  { permissions: ['health.read'] }
); // allowed: true

policy.evaluate(
  { capabilityId: 'deploy.production', target: 'vercel' },
  { permissions: ['deploy.production'] }
); // allowed: false, reason: approval_required
```

## Negative Rules

- `heidi` may not approve its own CRITICAL actions.
- `heidi` may not hold `credential.production` permission.
- Unknown actor with no permissions is blocked from all non-READ actions.
