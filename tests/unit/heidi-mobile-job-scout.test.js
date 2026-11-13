'use strict';

/**
 * Route tests for pages/api/heidi-mobile/job-scout.js — session/CSRF/RBAC
 * via the shared guard, decisions written in the exact Ursula format.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sealSession, COOKIE_NAME } = require('../../lib/heidi-mobile/session');
const { deriveSigningKey } = require('../../lib/auth/deviceAuth');
const { setDecision: ursulaSetDecision } = require('../../apps/ursula-frontend/src/lib/job-scout-store.ts');
const { setDecision: mobileSetDecision, readDecisions } = require('../../lib/job-scout/decisions.js');

const RAW_DEVICE_SECRET = 'e'.repeat(64);
const SIGNING_KEY = deriveSigningKey(RAW_DEVICE_SECRET);
const DEVICE_ID = 'phone-jobs';

let scoutDir;
let savedEnv;

function makeReq(reqOpts) {
  const { method = 'GET', body, query = {}, cookie, headers = {} } = reqOpts || {};
  const req = new (require('events').EventEmitter)();
  req.method = method;
  req.url = '/api/heidi-mobile/job-scout';
  req.body = body;
  req.query = query;
  req.headers = {
    host: 'heidi.test',
    ...(cookie ? { cookie } : {}),
    ...(method !== 'GET' ? { 'x-heidi-request': '1' } : {}),
    ...headers,
  };
  req.socket = { remoteAddress: '10.9.9.9' };
  return req;
}

function makeRes() {
  const res = new (require('events').EventEmitter)();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = jest.fn((k, v) => { res.headers[k.toLowerCase()] = v; return res; });
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; res.writableEnded = true; return res; });
  return res;
}

async function call(reqOpts) {
  const handler = require('../../pages/api/heidi-mobile/job-scout.js').default;
  const req = makeReq(reqOpts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

function sessionCookie() {
  return `${COOKIE_NAME}=${sealSession({ deviceId: DEVICE_ID, signingKey: SIGNING_KEY })}`;
}

beforeEach(() => {
  savedEnv = { ...process.env };
  scoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-scout-route-'));
  process.env.JOB_SCOUT_DIR = scoutDir;
  process.env.HYDI_SERVICE_SECRET = 'c'.repeat(64);
  process.env.HYDI_API_URL = 'http://hydi.test';
  process.env.NODE_ENV = 'test';
  require('../../lib/rate-limit').__reset();
  fs.writeFileSync(path.join(scoutDir, 'leads.json'), JSON.stringify({
    leads: [
      { id: 'freelancer:1', title: 'React build', score: 82, source: 'freelancer', sourceUrl: 'https://www.freelancer.com/projects/x' },
      { id: 'hn:2', title: 'SEEKING FREELANCER post', score: 60, source: 'hn', sourceUrl: 'https://news.ycombinator.com/item?id=2' },
    ],
  }));
  fs.writeFileSync(path.join(scoutDir, 'status.json'), JSON.stringify({ ranAt: new Date().toISOString(), ok: true, kept: 2 }));
});

afterEach(() => { process.env = savedEnv; });

describe('heidi-mobile job-scout route', () => {
  it('rejects unpaired phones and cross-site POSTs', async () => {
    const noAuth = await call({ cookie: null });
    expect(noAuth.statusCode).toBe(401);
    const csrf = await call({ method: 'POST', cookie: sessionCookie(), body: { id: 'freelancer:1', status: 'shortlisted' }, headers: { 'x-heidi-request': '' } });
    // makeReq only sets x-heidi-request for non-GET; override with explicit header removal
    const req = makeReq({ method: 'POST', cookie: sessionCookie(), body: { id: 'freelancer:1', status: 'shortlisted' } });
    delete req.headers['x-heidi-request'];
    const res = makeRes();
    await require('../../pages/api/heidi-mobile/job-scout.js').default(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('csrf_rejected');
    void csrf;
  });

  it('GET returns leads merged with decisions and scan status', async () => {
    mobileSetDecision('freelancer:1', 'shortlisted', scoutDir, new Date('2026-11-13T12:00:00Z'));
    const res = await call({ cookie: sessionCookie() });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status.kept).toBe(2);
    expect(res.body.leads).toHaveLength(2);
    const lead = res.body.leads.find((l) => l.id === 'freelancer:1');
    expect(lead.decision.status).toBe('shortlisted');
    expect(res.body.leads.find((l) => l.id === 'hn:2').decision).toBeNull();
  });

  it('POST shortlist/dismiss/applied writes decisions.json in the Ursula format', async () => {
    for (const status of ['shortlisted', 'dismissed', 'applied']) {
      const id = `freelancer:${status.length}`;
      fs.writeFileSync(path.join(scoutDir, 'leads.json'), JSON.stringify({
        leads: [{ id, title: 't', score: 80, sourceUrl: 'https://x' }],
      }));
      const res = await call({ method: 'POST', cookie: sessionCookie(), body: { id, status } });
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
    }
    const decisions = JSON.parse(fs.readFileSync(path.join(scoutDir, 'decisions.json'), 'utf8'));
    expect(Object.keys(decisions)).toHaveLength(3);
    for (const [id, d] of Object.entries(decisions)) {
      expect(d.status).toMatch(/^(shortlisted|dismissed|applied)$/);
      expect(d.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // 'clear' removes the entry.
    const cleared = await call({ method: 'POST', cookie: sessionCookie(), body: { id: 'freelancer:11', status: 'clear' } });
    expect(cleared.statusCode).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(scoutDir, 'decisions.json'), 'utf8'))).not.toHaveProperty('freelancer:11');
  });

  it('rejects apply — there is no such status', async () => {
    const res = await call({ method: 'POST', cookie: sessionCookie(), body: { id: 'freelancer:1', status: 'apply' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed lead ids', async () => {
    const res = await call({ method: 'POST', cookie: sessionCookie(), body: { id: 'not a lead', status: 'shortlisted' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('shared decisions format — both writers identical', () => {
  it('mobile decisions.js and Ursula job-scout-store produce byte-identical files', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'dec-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'dec-b-'));
    const now = new Date('2026-11-13T15:04:05.000Z');
    const writes = [
      ['freelancer:101', 'shortlisted'],
      ['hn:77', 'dismissed'],
      ['remoteok:9', 'applied'],
    ];
    for (const [id, status] of writes) {
      mobileSetDecision(id, status, dirA, now);
      ursulaSetDecision(id, status, dirB, now);
    }
    const a = fs.readFileSync(path.join(dirA, 'decisions.json'), 'utf8');
    const b = fs.readFileSync(path.join(dirB, 'decisions.json'), 'utf8');
    expect(a).toBe(b);
    expect(readDecisions(dirA)).toEqual(JSON.parse(b));
  });
});
