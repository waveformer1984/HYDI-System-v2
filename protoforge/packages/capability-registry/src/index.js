const DEFAULT_REGISTRY = [
  {
    name: 'Resonate',
    path: 'protoforge-applications/rezonate/src/index.js',
    versionFrom: 'protoforge-applications/rezonate/package.json',
    capabilities: ['audio-generation', 'asset-registry', 'ownership-tracking'],
    produces: ['audio.asset.created', 'processing.started', 'processing.completed', 'ownership.created', 'rights.registered'],
    consumes: ['ownership.updated', 'sample.library.loaded'],
    requires: ['local-model-runtime', 'audio-provider']
  },
  {
    name: 'Switchboard',
    path: 'switchboard/src/index.js',
    versionFrom: 'switchboard/package.json',
    capabilities: ['gig-management', 'contract-lifecycle', 'payment-tracking', 'trust-scoring'],
    produces: ['user.created', 'venue.created', 'gig.created', 'application.submitted', 'application.accepted', 'contract.created', 'contract.signed', 'payment.completed', 'rating.created'],
    consumes: ['user.parent_approved'],
    requires: ['json-store', 'availability-calendar']
  },
  {
    name: 'HYDI Event Gateway',
    path: 'protoforge/hydi-gateway/src/index.js',
    versionFrom: 'protoforge/hydi-gateway/package.json',
    capabilities: ['event-ingestion', 'idempotency', 'outbox-delivery'],
    produces: ['gateway.event.received', 'gateway.event.stored'],
    consumes: [],
    requires: ['raw-ledger-adapter', 'supabase']
  },
  {
    name: 'CASCADE',
    path: 'protoforge/cascade/src/index.js',
    versionFrom: 'protoforge/cascade/package.json',
    capabilities: ['event-processing', 'lineage', 'replay', 'derived-events'],
    produces: ['cascade.derived', 'cascade.replayed', 'cascade.metrics.snapshot'],
    consumes: ['*'],
    requires: ['raw-event-ledger', 'event-processor', 'derived-store']
  },
  {
    name: 'CASCADE Replay Engine',
    path: 'protoforge/cascade/src/replay.js',
    versionFrom: 'protoforge/cascade/package.json',
    capabilities: ['replay'],
    produces: ['cascade.replayed'],
    consumes: ['*'],
    requires: ['ledger-adapter']
  },
  {
    name: 'KILO',
    path: 'kilo/index.js',
    versionFrom: 'package.json',
    capabilities: ['hypothesis-generation'],
    produces: ['kilo.hypotheses'],
    consumes: ['cascade.derived'],
    requires: []
  },
  {
    name: 'ProtoForge PolicyEngine',
    path: 'lib/protoforge/policy-engine.js',
    versionFrom: 'package.json',
    capabilities: ['policy-evaluation', 'fail-closed-rules'],
    produces: ['protoforge.decision'],
    consumes: ['kilo.hypotheses'],
    requires: ['supabase', 'policies-table']
  },
  {
    name: 'ProtoForge Action Gate',
    path: 'lib/protoforge/action-gate.ts',
    versionFrom: 'package.json',
    capabilities: ['action-gating'],
    produces: [],
    consumes: ['protoforge.decision'],
    requires: ['policy-engine']
  },
  {
    name: 'Emission (EventBus)',
    path: 'lib/event-bus/index.ts',
    versionFrom: 'package.json',
    capabilities: ['event-emission', 'sse', 'api-logs'],
    produces: ['emission.event'],
    consumes: ['protoforge.decision'],
    requires: []
  },
  {
    name: 'Chat Router',
    path: 'api/chat/route.js',
    versionFrom: 'package.json',
    capabilities: ['chat-routing', 'status-queries'],
    produces: [],
    consumes: ['*'],
    requires: ['chat-endpoint']
  },
  {
    name: 'Legacy CASCADE Intake',
    path: 'modules/cascade-event-intake.js',
    versionFrom: 'package.json',
    capabilities: ['legacy-intake'],
    produces: ['cascade_output'],
    consumes: [],
    requires: ['cascade-core'],
    deprecated: true
  },
  {
    name: 'Legacy CASCADE Core',
    path: 'modules/cascade-core.js',
    versionFrom: 'package.json',
    capabilities: ['legacy-classification'],
    produces: ['cascade_output'],
    consumes: [],
    requires: [],
    deprecated: true
  },
  {
    name: 'Legacy CASCADE Health',
    path: 'modules/cascade-health-snapshot.js',
    versionFrom: 'package.json',
    capabilities: ['legacy-health'],
    produces: ['health.snapshot'],
    consumes: [],
    requires: [],
    deprecated: true
  },
  {
    name: 'Legacy Raw Event Ledger',
    path: 'modules/raw-event-ledger.js',
    versionFrom: 'package.json',
    capabilities: ['legacy-file-ledger'],
    produces: [],
    consumes: [],
    requires: [],
    deprecated: true
  },
  {
    name: 'Legacy Replay Engine (lib/protoforge)',
    path: 'lib/protoforge/replay-engine.ts',
    versionFrom: 'package.json',
    capabilities: ['legacy-replay'],
    produces: [],
    consumes: [],
    requires: [],
    deprecated: true
  },
  {
    name: 'Legacy Replay Engine (lib)',
    path: 'lib/replay-engine.ts',
    versionFrom: 'package.json',
    capabilities: ['legacy-replay'],
    produces: [],
    consumes: [],
    requires: [],
    deprecated: true
  },
  {
    name: 'Legacy Policy Engine (keeper)',
    path: 'keeper/policy-engine.js',
    versionFrom: 'package.json',
    capabilities: ['legacy-whitelist-policy'],
    produces: [],
    consumes: [],
    requires: [],
    deprecated: true
  },
  {
    name: 'Legacy Contextual Policy',
    path: 'keeper/policy/contextual-policy.js',
    versionFrom: 'package.json',
    capabilities: ['legacy-context-policy'],
    produces: [],
    consumes: [],
    requires: [],
    deprecated: true
  }
];

class CapabilityRegistry {
  constructor(entries = DEFAULT_REGISTRY) {
    this.entries = new Map(entries.map(e => [e.name, e]));
  }

  register(entry) {
    this.entries.set(entry.name, entry);
    return this;
  }

  get(name) {
    return this.entries.get(name) || null;
  }

  list() {
    return Array.from(this.entries.values());
  }

  findByEventType(type) {
    return this.list().filter(e => e.produces.includes(type) || e.consumes.includes(type));
  }

  findByCapability(capability) {
    return this.list().filter(e => e.capabilities.includes(capability));
  }

  findByRequirement(service) {
    return this.list().filter(e => e.requires.includes(service));
  }

  getProducers(eventType) {
    return this.list().filter(e => e.produces.includes(eventType));
  }

  getConsumers(eventType) {
    return this.list().filter(e => e.consumes.includes(eventType) || e.consumes.includes('*'));
  }
}

module.exports = { CapabilityRegistry, DEFAULT_REGISTRY };
