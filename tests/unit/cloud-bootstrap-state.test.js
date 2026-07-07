'use strict';

const { emptyState, recordResult, planRuns, STATE_VERSION } = require('../../scripts/cloud-bootstrap/state');

describe('cloud-bootstrap state', () => {
  test('emptyState starts with no services', () => {
    const state = emptyState();
    expect(state.version).toBe(STATE_VERSION);
    expect(state.services).toEqual({});
  });

  test('recordResult stores status, detail, actionRequired, and a timestamp', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    const state = recordResult(emptyState(), 'supabase', { status: 'blocked', detail: 'x', actionRequired: 'y' }, now);
    expect(state.services.supabase).toEqual({
      status: 'blocked',
      detail: 'x',
      actionRequired: 'y',
      lastChecked: '2026-07-07T12:00:00.000Z',
    });
  });

  test('recordResult does not mutate the input state (immutable update)', () => {
    const state = emptyState();
    recordResult(state, 'vercel', { status: 'verified', detail: 'ok' });
    expect(state.services).toEqual({});
  });

  test('planRuns includes a service with no prior record', () => {
    const state = emptyState();
    expect(planRuns(state, ['stripe'])).toEqual(['stripe']);
  });

  test('planRuns skips a recently-verified service within the TTL', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    let state = recordResult(emptyState(), 'stripe', { status: 'verified', detail: 'ok' }, now);
    const fiveMinLater = new Date('2026-07-07T12:05:00.000Z');
    expect(planRuns(state, ['stripe'], { now: fiveMinLater, ttlMs: 10 * 60 * 1000 })).toEqual([]);
  });

  test('planRuns re-includes a verified service once the TTL has elapsed', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    let state = recordResult(emptyState(), 'stripe', { status: 'verified', detail: 'ok' }, now);
    const elevenMinLater = new Date('2026-07-07T12:11:00.000Z');
    expect(planRuns(state, ['stripe'], { now: elevenMinLater, ttlMs: 10 * 60 * 1000 })).toEqual(['stripe']);
  });

  test('planRuns always retries a blocked service regardless of TTL', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    let state = recordResult(emptyState(), 'supabase', { status: 'blocked', detail: 'billing' }, now);
    const oneSecondLater = new Date('2026-07-07T12:00:01.000Z');
    expect(planRuns(state, ['supabase'], { now: oneSecondLater, ttlMs: 10 * 60 * 1000 })).toEqual(['supabase']);
  });

  test('planRuns always retries a failed service regardless of TTL', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    let state = recordResult(emptyState(), 'vercel', { status: 'failed', detail: 'boom' }, now);
    const oneSecondLater = new Date('2026-07-07T12:00:01.000Z');
    expect(planRuns(state, ['vercel'], { now: oneSecondLater, ttlMs: 10 * 60 * 1000 })).toEqual(['vercel']);
  });

  test('planRuns force=true re-includes every service even when freshly verified', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    let state = recordResult(emptyState(), 'stripe', { status: 'verified', detail: 'ok' }, now);
    expect(planRuns(state, ['stripe'], { force: true, now })).toEqual(['stripe']);
  });

  test('planRuns filters independently per service', () => {
    const now = new Date('2026-07-07T12:00:00.000Z');
    let state = recordResult(emptyState(), 'stripe', { status: 'verified', detail: 'ok' }, now);
    state = recordResult(state, 'supabase', { status: 'blocked', detail: 'billing' }, now);
    const fiveMinLater = new Date('2026-07-07T12:05:00.000Z');
    expect(planRuns(state, ['stripe', 'supabase', 'vercel'], { now: fiveMinLater, ttlMs: 10 * 60 * 1000 }))
      .toEqual(['supabase', 'vercel']);
  });
});
