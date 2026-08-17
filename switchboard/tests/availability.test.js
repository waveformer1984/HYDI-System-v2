const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApp } = require('../src/api');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, (err) => {
      if (err) return reject(err);
      resolve({ server, port: server.address().port });
    });
  });
}

describe('availability calendar', () => {
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

  after(() => { if (server) server.close(); });

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

  it('creates and retrieves a weekly profile', () => {
    const profile = repository.createAvailabilityProfile({
      user_id: 'u1',
      timezone: 'America/Chicago',
      weekly: { monday: [{ start: '09:00', end: '17:00' }], tuesday: [] }
    });
    assert.strictEqual(profile.user_id, 'u1');
    assert.strictEqual(profile.timezone, 'America/Chicago');
    const found = repository.getAvailabilityProfile('u1');
    assert.strictEqual(found.id, profile.id);
  });

  it('rejects invalid weekly schedule', () => {
    assert.throws(() => repository.createAvailabilityProfile({
      user_id: 'u1',
      weekly: { monday: [{ start: '25:00', end: '17:00' }] }
    }), Error);
  });

  it('computes slots for a date', () => {
    repository.createAvailabilityProfile({
      user_id: 'u1',
      weekly: { tuesday: [{ start: '09:00', end: '17:00' }] }
    });
    const slots = repository.getAvailabilityForDate('u1', '2026-08-04');
    assert.strictEqual(slots.length, 1);
    assert.ok(slots[0].start_time.includes('T09:00:00'));
  });

  it('applies exceptions when computing slots', () => {
    repository.createAvailabilityProfile({
      user_id: 'u2',
      weekly: { tuesday: [{ start: '09:00', end: '17:00' }] }
    });
    repository.createAvailabilityException({
      user_id: 'u2',
      start_time: '2026-08-04T00:00:00.000Z',
      end_time: '2026-08-04T23:59:59.000Z',
      reason: 'Personal event'
    });
    const slots = repository.getAvailabilityForDate('u2', '2026-08-04');
    assert.strictEqual(slots.length, 0);
  });

  it('finds next available slot', () => {
    repository.createAvailabilityProfile({
      user_id: 'u3',
      weekly: { tuesday: [{ start: '13:00', end: '18:00' }] }
    });
    const next = repository.getNextAvailableSlot('u3', '2026-08-03');
    assert.ok(next);
    assert.ok(next.slot);
  });

  it('emits events for availability mutations', () => {
    repository.createAvailabilityProfile({
      user_id: 'u4',
      weekly: { wednesday: [{ start: '10:00', end: '12:00' }] }
    });
    repository.createAvailabilityException({
      user_id: 'u4',
      start_time: '2026-08-05T10:00:00.000Z',
      end_time: '2026-08-05T11:00:00.000Z'
    });
    const events = repository.eventBus.transports[0].events;
    assert.ok(events.find(e => e.type === 'availability.created'));
    assert.ok(events.find(e => e.type === 'availability.exception_added'));
  });

  it('exposes availability via API', async () => {
    await post('/availability/u5', { timezone: 'UTC', weekly: { friday: [{ start: '09:00', end: '17:00' }] } });
    const data = await get('/availability/u5');
    assert.ok(data.profile);
    assert.ok(data.exceptions);
    assert.ok(data.nextSlot);
    const slots = await get('/availability/u5/date/2026-08-07');
    assert.strictEqual(slots.length, 1);
  });
});
