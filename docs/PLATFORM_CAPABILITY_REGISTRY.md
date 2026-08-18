# Platform Capability Registry

## Purpose

`@protoforge/capability-registry` is the canonical source for:

- What applications exist
- What each application produces
- What each application consumes
- What capabilities each application has
- What services each application requires

## Package

```text
protoforge/packages/capability-registry/
```

## Usage

```js
const { CapabilityRegistry } = require('@protoforge/capability-registry');

const reg = new CapabilityRegistry();
```

## Queries

```js
// Application by name
reg.get('Resonate');

// Producers of an event type
reg.getProducers('audio.asset.created');

// Consumers of an event type
reg.getConsumers('ownership.updated');

// Apps with a capability
reg.findByCapability('event-ingestion');

// Apps requiring a service
reg.findByRequirement('supabase');
```

## Default registry

| Application | Produces | Consumes | Requires |
|---|---|---|---|
| Resonate | `audio.asset.created`, `processing.completed`, `ownership.created`, `rights.registered` | `ownership.updated`, `sample.library.loaded` | `local-model-runtime`, `audio-provider` |
| Switchboard | `user.created`, `gig.created`, `contract.created`, `payment.completed`, ... | `user.parent_approved` | `json-store`, `availability-calendar` |
| HYDI Event Gateway | `gateway.event.received`, `gateway.event.stored` | — | `raw-ledger-adapter`, `supabase` |
| CASCADE | `cascade.derived`, `cascade.replayed` | `*` | `raw-event-ledger`, `event-processor`, `derived-store` |
| KILO | `kilo.hypotheses` | `cascade.derived` | — |
| ProtoForge PolicyEngine | `protoforge.decision` | `kilo.hypotheses` | `supabase`, `policies-table` |
| Emission Layer | `emission.event` | `protoforge.decision` | — |

## Diagnostics integration

`lib/platform-diagnostics.js` reads the registry to answer:

- What exists?
- What is running?
- What depends on what?
- What events does it produce?
- What events does it consume?

Each diagnostics component now includes `capabilities`, `produces`, `consumes`, and `requires`.

## Future registrations

To register a new ProtoForge application:

```js
reg.register({
  name: 'Proto YI',
  capabilities: ['builder'],
  produces: ['builder.blueprint.created'],
  consumes: ['protoforge.decision'],
  requires: ['event-bus']
});
```
