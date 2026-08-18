# @protoforge/event-contracts

Canonical event envelope, fingerprint, hash, and producer metadata for the HYDI platform.

## Install

```bash
npm install @protoforge/event-contracts
```

## Usage

```js
const { createEventEnvelope, computeFingerprint, computeHash, createProducerMetadata } = require('@protoforge/event-contracts');

const envelope = createEventEnvelope({
  eventId: 'evt-1',
  eventType: 'audio.asset.created',
  source: 'resonate',
  payload: { assetId: 'a1' }
});
```

## Test

```bash
npm test
```
