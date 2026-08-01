# ProtoForge Event Contracts

## Purpose

`@protoforge/event-contracts` is the canonical package every HYDI producer must use when emitting domain events. It guarantees:

- A single envelope schema
- Deterministic fingerprint and hash generation
- Shared producer metadata
- Capability declarations

## Package

```text
protoforge/packages/event-contracts/
```

## Event envelope

```js
const { createEventEnvelope } = require('@protoforge/event-contracts');

const envelope = createEventEnvelope({
  eventId: 'evt-1',
  eventType: 'audio.asset.created',
  source: 'resonate',
  version: '1',
  payload: { asset_id: 'a1' },
  producer: { name: 'Resonate', version: '1.0.0', capabilities: ['audio'] }
});
```

## Envelope schema

| Field | Type | Required | Description |
|---|---|---|---|
| `eventId` | string | yes | Unique id in the producer scope |
| `eventType` | string | yes | Canonical domain event type |
| `source` | string | yes | Producer name |
| `version` | string | yes | Schema version |
| `timestamp` | ISO 8601 | yes | Emission time |
| `payload` | object | yes | Domain payload only |
| `fingerprint` | hex | auto | SHA-256 of source + eventId + eventType |
| `hash` | hex | auto | SHA-256 of fingerprint + event_type + payload |
| `correlationId` | string | auto | Tracing id |

## Fingerprint and hash

```js
const { computeFingerprint, computeHash } = require('@protoforge/event-contracts');

const fingerprint = computeFingerprint('resonate', 'evt-1', 'audio.asset.created');
const hash = computeHash(fingerprint, 'audio.asset.created', { asset_id: 'a1' });
```

These match the canonical `RawLedgerAdapter` functions.

## Producer metadata

```js
const { createProducerMetadata } = require('@protoforge/event-contracts');

const meta = createProducerMetadata({
  name: 'Resonate',
  version: '1.0.0',
  capabilities: ['audio-generation']
});
```

## Capability declarations

```js
const { createCapabilityDeclaration } = require('@protoforge/event-contracts');

const caps = createCapabilityDeclaration({
  produces: ['audio.asset.created'],
  consumes: ['ownership.updated'],
  requires: ['local-model-runtime']
});
```

## Validation

```js
const { validateEventEnvelope } = require('@protoforge/event-contracts');

const result = validateEventEnvelope(envelope);
// result.ok and result.errors
```

## Migration for existing producers

Switchboard and Resonate should eventually consume this package. The migration is non-breaking:

1. Replace `computeFingerprint` / `computeHash` helpers with package exports.
2. Wrap emitted events with `createEventEnvelope`.
3. Attach `createProducerMetadata`.

Until the migration, the package is already used by the platform tests and diagnostics.
