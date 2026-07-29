const FederationGateway = require('../../../src/hydi-v3/FederationGateway');

describe('Federation replay protection', () => {
  let gw;

  beforeEach(() => {
    gw = new FederationGateway({ replayWindowMs: 5000 });
  });

  test('accepts a valid unique remote execute message', (done) => {
    gw.on('remote_execute', (ev) => {
      expect(ev.from).toBe('node-a');
      done();
    });
    gw._route({ from: 'node-a', type: 'remote_execute', payload: { task: { id: 't1' } } });
  });

  test('rejects an expired message', () => {
    const rejected = [];
    gw.on('message_rejected', (r) => rejected.push(r.reason));
    const msg = { from: 'node-a', type: 'remote_execute', payload: { task: { id: 't2' } }, timestamp: 1, expiresAt: 2 };
    gw._route(msg);
    expect(rejected).toContain('expired');
  });

  test('rejects a duplicate message', () => {
    const msg = { from: 'node-a', type: 'remote_execute', payload: { task: { id: 't3' } } };
    const rejected = [];
    gw.on('message_rejected', (r) => rejected.push(r.reason));
    gw._route(msg);
    gw._route(msg);
    expect(rejected).toContain('duplicate');
  });

  test('prunes old messages and allows the same payload after expiry', (done) => {
    const now = Date.now();
    const msg = { from: 'node-b', type: 'remote_execute', payload: { task: { id: 't4' } }, timestamp: now, expiresAt: now + 1 };
    gw._route(msg);
    setTimeout(() => {
      gw.on('remote_execute', (ev) => {
        expect(ev.from).toBe('node-b');
        done();
      });
      gw._route({ from: 'node-b', type: 'remote_execute', payload: { task: { id: 't4' } }, timestamp: Date.now() });
    }, 50);
  });

  test('records audit for rejected messages', () => {
    const msg = { from: 'node-a', type: 'remote_execute', payload: { task: { id: 't5' } }, timestamp: 1, expiresAt: 2 };
    gw._route(msg);
    expect(gw.audit.some((a) => a.action === 'message_rejected' && a.payload.reason === 'expired')).toBe(true);
  });
});
