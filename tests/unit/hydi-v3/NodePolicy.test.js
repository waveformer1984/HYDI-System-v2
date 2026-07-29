const NodePolicy = require('../../../src/hydi-v3/NodePolicy');

describe('NodePolicy', () => {
  test('allows actions for trusted nodes', () => {
    const policy = new NodePolicy({
      identity: { isTrusted: () => true, nodeId: 'self' },
    });
    const decision = policy.validateAction('execute', { nodeId: 'peer-a' });
    expect(decision.allowed).toBe(true);
    expect(policy.getAudit().length).toBe(1);
  });

  test('rejects actions from untrusted nodes', () => {
    const policy = new NodePolicy({
      identity: { isTrusted: () => false, nodeId: 'self' },
    });
    const decision = policy.validateAction('execute', { nodeId: 'peer-b' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('untrusted_node');
  });

  test('filters scheduler candidates by trust', () => {
    const policy = new NodePolicy({
      identity: { isTrusted: (id) => id === 'good' },
    });
    const candidates = [{ id: 'good' }, { id: 'bad' }];
    const filtered = policy.filter({ capability: 'general' }, candidates);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('good');
  });
});
