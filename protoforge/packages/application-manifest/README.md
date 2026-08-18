# @protoforge/application-manifest

Application manifest schema, loader, and lifecycle event emitter for ProtoForge.

## Install

```bash
npm install @protoforge/application-manifest
```

## Manifest schema

```js
const { createManifest, validateManifest } = require('@protoforge/application-manifest');

const manifest = createManifest({
  name: 'resonate',
  version: '1.0.0',
  capabilities: ['audio-generation'],
  eventsProduced: ['audio.asset.created'],
  eventsConsumed: ['ownership.updated'],
  providers: ['local-audio-provider'],
  dependencies: { services: ['supabase'], packages: [] },
  healthRequirements: ['supabase', 'local-model-runtime'],
  deprecated: false
});
```

## Lifecycle events

```js
const { LifecycleEmitter } = require('@protoforge/application-manifest');
const { RawLedgerAdapter } = require('@protoforge/hydi-gateway/src/adapters/raw-ledger');

const emitter = new LifecycleEmitter(new RawLedgerAdapter({ supabaseUrl, supabaseKey }));
await emitter.created(manifest);
await emitter.registered(manifest);
await emitter.started(manifest);
await emitter.healthChanged(manifest, { status: 'healthy' });
await emitter.deprecated(manifest);
```
