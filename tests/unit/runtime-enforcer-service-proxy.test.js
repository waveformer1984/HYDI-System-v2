'use strict';

const RuntimeEnforcer = require('../../src/enforcement/RuntimeEnforcer');

describe('RuntimeEnforcer.createServiceProxy', () => {
  function buildEnforcerWithRegisteredService(serviceName, type) {
    const enforcer = new RuntimeEnforcer({ enableModuleHooking: false });
    // Bypass real manifest loading (async, filesystem-backed) -- simulate
    // the post-load state directly, since only validateService()'s
    // behavior is under test here.
    enforcer.manifest = {};
    enforcer.registeredServices.set(serviceName, { type, status: 'active' });
    return enforcer;
  }

  test('get trap resolves the service instance instead of throwing on `this`', () => {
    const enforcer = buildEnforcerWithRegisteredService('TestService', 'orchestrator');
    const proxy = enforcer.createServiceProxy('TestService');

    // Regression guard: the `get`/`has` traps used to be plain object-
    // literal methods, so `this` inside them was the Proxy handler
    // object, not the RuntimeEnforcer instance -- accessing any property
    // threw "this.validateService is not a function" instead of ever
    // returning the underlying service.
    expect(() => proxy.access).not.toThrow();
    expect(proxy.access).toEqual({ name: 'TestService', type: 'orchestrator', status: 'active' });
  });

  test('get trap still rejects a disallowed operation for the service type', () => {
    const enforcer = buildEnforcerWithRegisteredService('TestService', 'infrastructure');
    const proxy = enforcer.createServiceProxy('TestService');

    // 'infrastructure' only allows ['access', 'monitor'] -- 'execute' is not.
    expect(() => proxy.execute).toThrow(/Operation denied/);
  });

  test('has trap resolves without throwing on `this`', () => {
    const enforcer = buildEnforcerWithRegisteredService('TestService', 'orchestrator');
    const proxy = enforcer.createServiceProxy('TestService');

    expect(() => 'type' in proxy).not.toThrow();
    expect('type' in proxy).toBe(true);
  });
});
