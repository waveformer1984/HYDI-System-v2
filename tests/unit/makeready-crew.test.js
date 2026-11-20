'use strict';

const fs = require('fs');
const path = require('path');
const {
  verifyPin,
  createSession,
  verifyToken,
  requireCrewSession,
  sessionSecret,
} = require('../../lib/makeready-crew/auth');
const { canTransition } = require('../../lib/makeready-crew/status');
const { enqueue, applySyncResults, onlineStatus } = require('../../lib/makeready-crew/offline-queue');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20261120210000_makeready_crew.sql'),
  'utf8',
);

describe('makeready crew migration', () => {
  it('adds crew_status and operational columns', () => {
    expect(MIGRATION).toMatch(/crew_status/);
    expect(MIGRATION).toMatch(/scheduled_at/);
    expect(MIGRATION).toMatch(/completion_photos/);
  });
});

describe('makeready crew auth', () => {
  const prevPin = process.env.MAKEREADY_CREW_PIN;
  const prevSecret = process.env.MAKEREADY_CREW_SESSION_SECRET;

  afterEach(() => {
    process.env.MAKEREADY_CREW_PIN = prevPin;
    process.env.MAKEREADY_CREW_SESSION_SECRET = prevSecret;
  });

  it('requires configured pin and secret', () => {
    process.env.MAKEREADY_CREW_PIN = '123456';
    process.env.MAKEREADY_CREW_SESSION_SECRET = 'test-secret-32chars-minimum-xxxxx';
    expect(verifyPin('123456')).toBe(true);
    expect(verifyPin('wrong')).toBe(false);
    const token = createSession('jenny-slug');
    expect(token).toBeTruthy();
    const session = verifyToken(token);
    expect(session.company_slug).toBe('jenny-slug');
  });

  it('requireCrewSession rejects missing cookie', () => {
    process.env.MAKEREADY_CREW_SESSION_SECRET = 'test-secret-32chars-minimum-xxxxx';
    expect(() => requireCrewSession({ headers: {} })).toThrow();
  });

  it('fails closed without session secret', () => {
    delete process.env.MAKEREADY_CREW_SESSION_SECRET;
    delete process.env.HYDI_SERVICE_SECRET;
    delete process.env.AUTH_SECRET;
    expect(sessionSecret()).toBe('');
    expect(createSession('x')).toBeNull();
  });
});

describe('makeready crew status transitions', () => {
  it('allows happy path', () => {
    expect(canTransition('new', 'accept').ok).toBe(true);
    expect(canTransition('scheduled', 'start').ok).toBe(true);
    expect(canTransition('in_progress', 'complete').ok).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('new', 'complete').ok).toBe(false);
    expect(canTransition('done', 'start').ok).toBe(false);
  });
});

describe('makeready crew offline queue', () => {
  it('enqueues and drops synced items', () => {
    const q = enqueue([], { clientId: 'a1', requestId: 'id', action: 'start', payload: {} });
    expect(q).toHaveLength(1);
    const left = applySyncResults(q, [{ clientId: 'a1', ok: true }]);
    expect(left).toHaveLength(0);
  });

  it('keeps failed sync items', () => {
    const q = enqueue([], { clientId: 'b1', requestId: 'id', action: 'start', payload: {} });
    const left = applySyncResults(q, [{ clientId: 'b1', ok: false, error: 'offline' }]);
    expect(left).toHaveLength(1);
  });

  it('reports offline honestly', () => {
    expect(onlineStatus(false)).toBe('offline');
    expect(onlineStatus(true)).toBe('online');
  });
});