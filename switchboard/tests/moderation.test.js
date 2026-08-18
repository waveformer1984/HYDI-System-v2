const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApp } = require('../src/api');

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, (err) => {
      if (err) return reject(err);
      resolve({ server, port: server.address().port });
    });
  });
}

describe('moderation console', () => {
  let repository, app, server, port;

  before(async () => {
    process.env.SWITCHBOARD_STORE = 'memory';
    repository = createRepository();
    await repository.init();
    app = createApp(repository);
    const l = await listen(app);
    server = l.server;
    port = l.port;
  });

  after(() => {
    if (server) server.close();
  });

  async function post(path, body) {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `POST ${path} failed`);
    return data;
  }

  async function get(path) {
    const res = await fetch(`http://localhost:${port}${path}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `GET ${path} failed`);
    return data;
  }

  it('creates a moderation case through repository', () => {
    const c = repository.createModerationCase({ targetType: 'message', targetId: 'm1', reason: 'Contains phone number' });
    assert.strictEqual(c.status, 'flagged');
    assert.strictEqual(c.targetType, 'message');
    const found = repository.getModerationCase(c.id);
    assert.strictEqual(found.id, c.id);
  });

  it('lists the queue and filters by status', () => {
    repository.createModerationCase({ targetType: 'application', targetId: 'a1', reason: 'External contact' });
    const all = repository.getModerationQueue();
    const flagged = repository.getModerationQueue('flagged');
    assert.ok(all.length >= 2);
    assert.ok(flagged.length >= 1);
  });

  it('quarantines and releases a message case', () => {
    const msg = repository.createMessage({ sender_id: 'u1', recipient_id: 'u2', content: 'Call me 555-1234' });
    const c = repository.createModerationCase({ targetType: 'message', targetId: msg.id, reason: 'Phone number' });
    const q = repository.updateModerationStatus(c.id, { status: 'quarantined', reviewedBy: 'mod1', note: 'Hold for review' });
    assert.strictEqual(q.status, 'quarantined');
    assert.strictEqual(q.notes.length, 1);
    const updatedMsg = repository.getMessages('u1', 'u2').find(m => m.id === msg.id);
    assert.strictEqual(updatedMsg.quarantined, 1);

    const r = repository.updateModerationStatus(c.id, { status: 'released', reviewedBy: 'mod1' });
    assert.strictEqual(r.status, 'released');
  });

  it('emits moderation events for case actions', () => {
    const c = repository.createModerationCase({ targetType: 'user', targetId: 'u9', reason: 'Spam' });
    repository.updateModerationStatus(c.id, { status: 'restricted', reviewedBy: 'mod2' });
    const events = repository.eventBus.transports[0].events;
    const created = events.find(e => e.type === 'moderation.created');
    const restricted = events.find(e => e.type === 'user.restricted');
    assert.ok(created, 'emits moderation.created');
    assert.ok(restricted, 'emits user.restricted');
  });

  it('exposes moderation queue via API', async () => {
    const queue = await get('/moderation/queue');
    assert.ok(Array.isArray(queue));
  });

  it('transitions case through API endpoints', async () => {
    const c = await post('/messages', { sender_id: 'u1', recipient_id: 'u2', content: 'email me at bad@example.com' });
    const queue = await get('/moderation/queue');
    const modCase = queue.find(m => m.targetId === c.id);
    assert.ok(modCase, 'API creates moderation case for flagged message');
    const q = await post(`/moderation/${modCase.id}/quarantine`, { reviewedBy: 'mod1', note: 'Hold for review' });
    assert.strictEqual(q.status, 'quarantined');
    const r = await post(`/moderation/${modCase.id}/notes`, { author: 'mod1', note: 'Looks suspicious' });
    assert.strictEqual(r.notes.length, 2);
  });
});
