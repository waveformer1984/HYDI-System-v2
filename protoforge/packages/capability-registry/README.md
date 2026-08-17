# @protoforge/capability-registry

Canonical registry of platform applications, their capabilities, produced/consumed event types, and service requirements.

## Install

```bash
npm install @protoforge/capability-registry
```

## Usage

```js
const { CapabilityRegistry } = require('@protoforge/capability-registry');

const reg = new CapabilityRegistry();
const producers = reg.getProducers('audio.asset.created');
```

## Test

```bash
npm test
```
