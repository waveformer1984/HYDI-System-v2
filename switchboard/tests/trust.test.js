const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApp } = require('../src/api');

describe('trust layer', () => {
  let repository;
  let app;
  let server;
  let port;

  before(async () => {
    process.env.SWITCHBOARD_STORE = 'memory';
    repository = createRepository();
    await repository.init();
    app = createApp(repository);
    await new Promise(resolve => { server = app.listen(0, () => { port = server.address().port; resolve(); }); });
  });

  after(() => server.close());

  async function post(path, body) {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || `POST ${path} failed`);
    return data;
  }

  it('accepts an application and creates a contract', async () => {
    const venueUser = await post('/users', { email: 'v2@x.com', password: 'password', name: 'V', role: 'venue', age: 30 });
    const performer = await post('/users', { email: 'p2@x.com', password: 'password', name: 'P', role: 'performer', age: 20, skills: ['guitar'] });
    const venue = await post('/venues', { owner_id: venueUser.id, name: 'Venue', latitude: 40.7, longitude: -74.0 });
    const gig = await post('/gigs', { venue_id: venue.id, title: 'Show', required_skills: ['guitar'], start_time: '2026-08-01T18:00:00Z', end_time: '2026-08-01T22:00:00Z', latitude: 40.7, longitude: -74.0, budget: 300 });
    const appRes = await post(`/gigs/${gig.id}/apply`, { user_id: performer.id });
    const accepted = await post(`/applications/${appRes.application.id}/accept`);
    assert.strictEqual(accepted.application.status, 'approved');
    assert.strictEqual(accepted.contract.status, 'draft');
    assert.strictEqual(accepted.contract.amount, 300);

    const signedPerformer = await post(`/contracts/${accepted.contract.id}/sign`, { user_id: performer.id });
    assert.strictEqual(signedPerformer.performer_signed, 1);
    const signedVenue = await post(`/contracts/${signedPerformer.id}/sign`, { user_id: venueUser.id });
    assert.strictEqual(signedVenue.status, 'signed');

    const payment = await post('/payments', { contract_id: signedVenue.id, amount: 300, paid_by: venueUser.id, paid_to: performer.id });
    const released = await post(`/payments/${payment.id}/release`);
    assert.strictEqual(released.status, 'completed');

    const completed = await post(`/contracts/${signedVenue.id}/complete`);
    assert.strictEqual(completed.status, 'completed');

    const rating = await post('/ratings', { contract_id: completed.id, rater_id: venueUser.id, ratee_id: performer.id, score: 5 });
    assert.strictEqual(rating.score, 5);
  });

  it('approves a protected user and clears pending applications', async () => {
    const parent = await post('/users', { email: 'parent@x.com', password: 'password', name: 'Parent', role: 'admin', age: 40 });
    const child = await post('/users', { email: 'child@x.com', password: 'password', name: 'Kid', role: 'performer', age: 14, parent_email: parent.email });
    const venueUser = await post('/users', { email: 'pv@x.com', password: 'password', name: 'PV', role: 'venue', age: 30 });
    const venue = await post('/venues', { owner_id: venueUser.id, name: 'PVenue', latitude: 40.7, longitude: -74.0 });
    const gig = await post('/gigs', { venue_id: venue.id, title: 'Kid Show', required_skills: [], start_time: '2026-09-01T18:00:00Z', end_time: '2026-09-01T22:00:00Z', budget: 100 });
    const appRes = await post(`/gigs/${gig.id}/apply`, { user_id: child.id });
    assert.strictEqual(appRes.application.status, 'pending_approval');
    const approved = await post(`/users/${child.id}/parent-approve`, { parent_email: parent.email });
    assert.strictEqual(approved.user.parent_approved, true);
    assert.strictEqual(approved.applicationsApproved, 1);
  });

  it('rejects rating before contract completion', async () => {
    const venueUser = await post('/users', { email: 'v3@x.com', password: 'password', name: 'V3', role: 'venue', age: 30 });
    const performer = await post('/users', { email: 'p3@x.com', password: 'password', name: 'P3', role: 'performer', age: 20 });
    const venue = await post('/venues', { owner_id: venueUser.id, name: 'V3', latitude: 40.7, longitude: -74.0 });
    const gig = await post('/gigs', { venue_id: venue.id, title: 'Show', required_skills: [], start_time: '2026-08-01T18:00:00Z', end_time: '2026-08-01T22:00:00Z', budget: 100 });
    const appRes = await post(`/gigs/${gig.id}/apply`, { user_id: performer.id });
    const accepted = await post(`/applications/${appRes.application.id}/accept`);
    const res = await fetch(`http://localhost:${port}/ratings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract_id: accepted.contract.id, rater_id: venueUser.id, ratee_id: performer.id, score: 5 }) });
    assert.strictEqual(res.status, 400);
  });
});
