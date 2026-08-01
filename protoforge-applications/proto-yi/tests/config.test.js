const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createConfig } = require('../src/config');
const { createRepository } = require('../src/repository');
const { ExternalAdapter } = require('../src/events/event-bus');

describe('Config and HYDI enablement', () => {
  it('remains local-only when no HYDI gateway is configured', () => {
    const config = createConfig({});

    assert.strictEqual(config.hydiGatewayEndpoint, '');
    assert.strictEqual(config.hydiServiceKey, undefined);
    assert.strictEqual(config.eventTransport, 'memory');

    const repo = createRepository({ config });
    const hasExternal = repo.eventBus.transports.some(t => t instanceof ExternalAdapter);
    assert.strictEqual(hasExternal, false);
  });

  it('activates the ExternalAdapter when HYDI_GATEWAY_ENDPOINT is configured', () => {
    const config = createConfig({
      HYDI_GATEWAY_ENDPOINT: 'http://gateway.test',
      HYDI_SERVICE_KEY: 'test-service-key'
    });

    assert.strictEqual(config.hydiGatewayEndpoint, 'http://gateway.test');
    assert.strictEqual(config.hydiServiceKey, 'test-service-key');
    assert.strictEqual(config.eventTransport, 'external');

    const repo = createRepository({ config });
    const adapter = repo.eventBus.transports.find(t => t instanceof ExternalAdapter);

    assert.ok(adapter);
    assert.strictEqual(adapter.endpoint, 'http://gateway.test');
    assert.strictEqual(adapter.serviceKey, 'test-service-key');
    assert.deepStrictEqual(adapter.eventTypes, ['project.created', 'project.updated', 'project.deleted', 'task.created', 'task.completed', 'timeline.created', 'milestone.scheduled', 'proto.yi.blueprint.created']);
    assert.strictEqual(adapter.enabled, true);
  });

  it('honours EVENT_TRANSPORT override even without an endpoint', () => {
    const config = createConfig({ EVENT_TRANSPORT: 'external' });
    assert.strictEqual(config.eventTransport, 'external');
    assert.strictEqual(config.hydiGatewayEndpoint, '');
  });
});
