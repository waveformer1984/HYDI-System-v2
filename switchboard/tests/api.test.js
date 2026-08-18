const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApp } = require('../src/api');

describe('api', () => {
  let repository;
  let app;
  let server;
  let port;

  before(async () => {
    process.env.SWITCHBOARD_STORE = 'memory';
    repository = createRepository();
    await repository.init();
    app = createApp(repository);
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(() => server.close());

  it('responds to /health', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.service, 'switchboard');
  });

  it('creates a user and gig', async () => {
    const u = await (await fetch(`http://localhost:${port}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'venue@example.com', password: 'secret', name: 'Venue Owner', role: 'venue'
      })
    })).json();
    assert.ok(u.id);
    const v = await (await fetch(`http://localhost:${port}/venues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: u.id, name: 'The Blue Note', latitude: 40.7, longitude: -74.0 })
    })).json();
    assert.ok(v.id);
    const g = await (await fetch(`http://localhost:${port}/gigs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venue_id: v.id, title: 'Jazz Night', required_skills: ['saxophone'],
        start_time: '2026-08-01T18:00:00Z', end_time: '2026-08-01T22:00:00Z',
        latitude: 40.7, longitude: -74.0, budget: 200
      })
    })).json();
    assert.ok(g.id);
    const list = await (await fetch(`http://localhost:${port}/gigs`)).json();
    assert.ok(list.length >= 1);
  });

  it('emits domain events for state changes', async () => {
    const transport = repository.eventBus.transports[0];
    transport.reset();
    await (await fetch(`http://localhost:${port}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'performer@example.com', password: 'secret', name: 'Alice', role: 'performer' })
    })).json();
    const events = transport.ofType('user.created');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].payload.name, 'Alice');
  });
});
