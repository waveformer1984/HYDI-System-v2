const { describe, it } = require('node:test');
const assert = require('node:assert');
const scoring = require('../src/scoring');

describe('scoring engine', () => {
  it('ranks a user high when all factors align', () => {
    const user = {
      id: 'u1', skills: ['guitar','vocals'], latitude: 40.7, longitude: -74.0, age: 20
    };
    const gig = {
      id: 'g1', required_skills: ['guitar'], start_time: '2026-08-01T18:00:00Z', end_time: '2026-08-01T22:00:00Z',
      latitude: 40.71, longitude: -74.01
    };
    const context = {
      availability: [{ start_time: '2026-08-01T10:00:00Z', end_time: '2026-08-02T02:00:00Z' }],
      ratings: [{ ratee_id: 'u1', score: 5 }],
      contracts: [{ performer_id: 'u1', status: 'completed' }],
      applications: []
    };
    const result = scoring.matchUserForGig(user, gig, context);
    assert.ok(result.total >= 0.7, `expected high score, got ${result.total}`);
    assert.ok(result.factors.length === 6);
    assert.ok(result.factors.some(f => f.name === 'skill_match'));
  });

  it('gives zero availability when no overlap', () => {
    const user = { id: 'u1', skills: [], latitude: null, longitude: null };
    const gig = { id: 'g1', required_skills: [], start_time: '2026-08-01T18:00:00Z', end_time: '2026-08-01T22:00:00Z' };
    const context = {
      availability: [{ start_time: '2026-08-02T10:00:00Z', end_time: '2026-08-02T12:00:00Z' }]
    };
    const result = scoring.matchUserForGig(user, gig, context);
    const avail = result.factors.find(f => f.name === 'availability');
    assert.strictEqual(avail.score, 0);
  });

  it('ranks applications by score', () => {
    const gig = { id: 'g1', required_skills: ['guitar'], start_time: '2026-08-01T18:00:00Z', end_time: '2026-08-01T22:00:00Z', latitude: 40.7, longitude: -74.0 };
    const apps = [
      { id: 'a1', user_id: 'u1', gig_id: 'g1', status: 'pending' },
      { id: 'a2', user_id: 'u2', gig_id: 'g1', status: 'pending' }
    ];
    const users = [
      { id: 'u1', skills: '[]', latitude: 40.7, longitude: -74.0 },
      { id: 'u2', skills: '["guitar"]', latitude: 40.71, longitude: -74.01 }
    ];
    const ranked = scoring.rankApplicationsForGig(gig, apps, users, { availability: [], ratings: [], contracts: [], applications: [] });
    assert.strictEqual(ranked[0].user.id, 'u2');
  });
});
