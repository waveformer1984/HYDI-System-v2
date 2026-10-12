'use strict';

const { createJobsHandler } = require('../../api/mobile-ops/jobs.js');
const { JobManager } = require('../../lib/mobile-ops/job-manager');
const { EventEmitter } = require('events');

function res() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function setup(role = 'operator') {
  const spawn = jest.fn(() => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.pid = 4242;
    return c;
  });
  const jm = new JobManager({
    spawn,
    killTree: jest.fn(),
    root: '/repo',
    jobs: {
      'walkie.tests': { permission: 'ops:run_tests', confirmRequired: true, summary: 'w', timeoutMs: 60000, steps: () => [{ label: 'x', cmd: 'npm', args: ['test'], cwd: '/repo' }] },
      'walkie.android.build': { permission: 'ops:build', confirmRequired: true, summary: 'b', timeoutMs: 60000, steps: () => [{ label: 'g', cmd: './gradlew', args: ['assembleDebug'], cwd: '/repo' }] },
    },
  });
  const audit = jest.fn(async () => {});
  let authed = { ok: true, role, deviceId: 'phone-1' };
  const handler = createJobsHandler({
    authenticate: async (_req, r) => {
      if (!authed.ok) r.status(401).json({ error: 'unauthorized' });
      return authed;
    },
    manager: () => jm,
    audit,
  });
  return { handler, jm, audit, spawn, setAuth: (a) => (authed = a) };
}

const call = (handler, method, { body, query } = {}) => {
  const r = res();
  return handler({ method, body, query: query || {} }, r).then(() => r);
};

describe('/api/mobile-ops/jobs', () => {
  it('requires authentication', async () => {
    const { handler, setAuth } = setup();
    setAuth({ ok: false });
    expect((await call(handler, 'GET')).statusCode).toBe(401);
    expect((await call(handler, 'POST', { body: { kind: 'walkie.tests', confirm: true } })).statusCode).toBe(401);
  });

  it('lists the catalog for the caller role', async () => {
    const { handler } = setup('viewer');
    const r = await call(handler, 'GET');
    expect(r.statusCode).toBe(200);
    expect(r.body.catalog).toEqual([]);
  });

  it('starts a job (202), audits it, and pages its log by cursor', async () => {
    const { handler, audit, spawn } = setup();
    const r = await call(handler, 'POST', { body: { kind: 'walkie.tests', confirm: true } });
    expect(r.statusCode).toBe(202);
    expect(spawn).toHaveBeenCalledWith('npm', ['test'], expect.objectContaining({ cwd: '/repo' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'mobile_ops_job_start', device_id: 'phone-1', reason: 'walkie.tests' }));
    const id = r.body.job.id;
    const g = await call(handler, 'GET', { query: { id, since: '0' } });
    expect(g.statusCode).toBe(200);
    expect(g.body.job.state).toBe('running');
    expect(g.body.lines.length).toBeGreaterThan(0);
  });

  it('rejects missing confirmation, forbidden roles, busy and bad ids', async () => {
    const { handler, setAuth, audit } = setup();
    expect((await call(handler, 'POST', { body: { kind: 'walkie.tests' } })).statusCode).toBe(400);
    expect((await call(handler, 'POST', { body: { kind: 'shell', confirm: true } })).statusCode).toBe(400);
    expect((await call(handler, 'POST', { body: { kind: 'walkie.tests', confirm: true } })).statusCode).toBe(202);
    expect((await call(handler, 'POST', { body: { kind: 'walkie.tests', confirm: true } })).statusCode).toBe(409);
    setAuth({ ok: true, role: 'agent', deviceId: 'x' });
    expect((await call(handler, 'POST', { body: { kind: 'walkie.android.build', confirm: true } })).statusCode).toBe(403);
    expect((await call(handler, 'GET', { query: { id: 'not-an-id' } })).statusCode).toBe(400);
    expect((await call(handler, 'GET', { query: { id: '0123456789abcdef' } })).statusCode).toBe(404);
    expect(audit.mock.calls.some(([e]) => e.event_type === 'mobile_ops_job_rejected')).toBe(true);
  });

  it('cancels a running job and audits it', async () => {
    const { handler, audit } = setup();
    const id = (await call(handler, 'POST', { body: { kind: 'walkie.tests', confirm: true } })).body.job.id;
    const c = await call(handler, 'POST', { body: { id, cancel: true } });
    expect(c.statusCode).toBe(200);
    expect(c.body.job.state).toBe('cancelled');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'mobile_ops_job_cancel' }));
    expect((await call(handler, 'POST', { body: { id: 'x', cancel: true } })).statusCode).toBe(400);
  });

  it('only GET and POST', async () => {
    const { handler } = setup();
    expect((await call(handler, 'DELETE')).statusCode).toBe(405);
  });
});
