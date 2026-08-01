const { describe, it } = require('node:test');
const assert = require('node:assert');

const { ApplicationRegistry, LIFECYCLE_STATES, canTransition, isValidState } = require('../src/index');

describe('ApplicationRegistry', () => {
  it('exposes lifecycle states', () => {
    assert.deepStrictEqual(LIFECYCLE_STATES, ['created', 'registered', 'active', 'degraded', 'deprecated', 'archived']);
  });

  it('valid states include all expected values', () => {
    for (const s of LIFECYCLE_STATES) {
      assert.strictEqual(isValidState(s), true);
    }
    assert.strictEqual(isValidState('unknown'), false);
  });

  it('allows created -> registered', () => {
    assert.strictEqual(canTransition('created', 'registered'), true);
  });

  it('allows registered -> active', () => {
    assert.strictEqual(canTransition('registered', 'active'), true);
  });

  it('allows active -> degraded', () => {
    assert.strictEqual(canTransition('active', 'degraded'), true);
  });

  it('allows active -> deprecated', () => {
    assert.strictEqual(canTransition('active', 'deprecated'), true);
  });

  it('allows deprecated -> archived', () => {
    assert.strictEqual(canTransition('deprecated', 'archived'), true);
  });

  it('prevents active -> archived', () => {
    assert.strictEqual(canTransition('active', 'archived'), false);
  });

  it('prevents archived -> anything', () => {
    assert.strictEqual(canTransition('archived', 'created'), false);
    assert.strictEqual(canTransition('archived', 'active'), false);
  });

  it('registers a new application', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    const app = reg.register({
      name: 'Proto YI',
      version: '0.1.0',
      capabilities: ['builder']
    });
    assert.strictEqual(app.name, 'Proto YI');
    assert.strictEqual(app.status, 'created');
    assert.ok(app.registeredAt);
  });

  it('requires a name to register', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    assert.throws(() => reg.register({ version: '0.1.0' }), /name is required/);
  });

  it('rejects invalid initial status', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    assert.throws(() => reg.register({ name: 'x', status: 'broken' }), /Invalid lifecycle state/);
  });

  it('retrieves an application by name', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'Proto YI' });
    const found = reg.get('proto yi');
    assert.ok(found);
    assert.strictEqual(found.name, 'Proto YI');
  });

  it('lists all applications', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'A' });
    reg.register({ name: 'B' });
    const list = reg.list();
    assert.strictEqual(list.length, 2);
  });

  it('filters by status', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'Active', status: 'active' });
    reg.register({ name: 'Deprecated', status: 'deprecated' });
    assert.strictEqual(reg.getByStatus('active').length, 1);
    assert.strictEqual(reg.getByStatus('deprecated')[0].name, 'Deprecated');
  });

  it('transitions through happy path', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'App' });
    let result = reg.transition('App', 'registered');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.application.status, 'registered');
    result = reg.transition('App', 'active');
    assert.strictEqual(result.application.status, 'active');
  });

  it('rejects invalid transitions', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'App', status: 'active' });
    const result = reg.transition('App', 'archived');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('Cannot transition'));
  });

  it('deprecates and archives an app', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'App', status: 'active' });
    const dep = reg.deprecate('App');
    assert.strictEqual(dep.ok, true);
    assert.strictEqual(dep.application.status, 'deprecated');
    const arc = reg.archive('App');
    assert.strictEqual(arc.ok, true);
    assert.strictEqual(arc.application.status, 'archived');
  });

  it('loads manifests from disk', () => {
    const reg = new ApplicationRegistry({ autoLoad: true });
    const list = reg.list();
    const names = list.map(a => a.name);
    assert.ok(names.includes('Resonate'));
    assert.ok(names.includes('Switchboard'));
  });

  it('deletes an application', () => {
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'Gone' });
    assert.strictEqual(reg.delete('Gone'), true);
    assert.strictEqual(reg.get('Gone'), null);
  });
});
