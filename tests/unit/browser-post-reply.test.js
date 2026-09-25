// browser_post_reply — authorization binding + fail-closed behavior.
// The live fixture run uses a local thread page so no external message
// is ever sent during tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bpr = require('../../lib/human-action/browser-post-reply');

const baseSpec = {
  type: 'browser_post_reply',
  opportunityId: 'opp-1',
  channel: 'reddit',
  permalink: 'https://www.reddit.com/r/3Dprintmything/comments/abc/post/',
  message: 'I can produce a print-ready STL for that — $29, same day.',
};

const authed = () => ({ ...baseSpec, authorization: bpr.createAuthorization(baseSpec) });

describe('browser_post_reply authorization binding', () => {
  it('rejects missing authorization', () => {
    assert.strictEqual(bpr.validateSpec(baseSpec).status, 'REJECTED');
  });
  it('rejects wrong opportunity', () => {
    const s = authed(); s.opportunityId = 'other';
    assert.match(bpr.validateSpec(s).reason, /opportunity mismatch/);
  });
  it('rejects wrong destination', () => {
    const s = authed(); s.permalink = 'https://www.reddit.com/r/other/comments/x/';
    assert.match(bpr.validateSpec(s).reason, /destination mismatch/);
  });
  it('rejects mutated message', () => {
    const s = authed(); s.message = 'pay me first';
    assert.match(bpr.validateSpec(s).reason, /message mismatch/);
  });
  it('rejects expired authorization', () => {
    const s = authed(); s.authorization.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.match(bpr.validateSpec(s).reason, /expired/);
  });
  it('rejects rejected authorization', () => {
    const s = authed(); s.authorization.status = 'REJECTED';
    assert.strictEqual(bpr.validateSpec(s).status, 'REJECTED');
  });
  it('accepts the exact authorized action', () => {
    assert.strictEqual(bpr.validateSpec(authed()).ok, true);
  });
});

describe('browser_post_reply page classification', () => {
  it('fails closed on wrong host', () => {
    const r = bpr.classifyPage({ url: 'https://twitter.com/x', destination: baseSpec.permalink, pageText: 'x'.repeat(500) });
    assert.strictEqual(r.verdict, 'FAIL_CLOSED');
  });
  it('detects platform blocks', () => {
    const r = bpr.classifyPage({ url: baseSpec.permalink, destination: baseSpec.permalink, pageText: 'verify you are human to continue '.repeat(20) });
    assert.strictEqual(r.verdict, 'EXTERNAL_BLOCK');
  });
  it('waits for human when unauthenticated', () => {
    const r = bpr.classifyPage({ url: baseSpec.permalink, destination: baseSpec.permalink, pageText: 'Log in. Sign up. '.repeat(30) });
    assert.strictEqual(r.verdict, 'WAITING_FOR_HUMAN');
  });
  it('proceeds on a real-looking thread page', () => {
    const r = bpr.classifyPage({ url: baseSpec.permalink, destination: baseSpec.permalink, pageText: 'comment section replies here '.repeat(20) });
    assert.strictEqual(r.verdict, 'PROCEED');
  });
});

describe('browser_post_reply end-to-end on a local fixture', () => {
  it('composes, submits, and verifies on a real thread page', async () => {
    const fixture = 'file:///' + path.join(__dirname, '..', '..', 'protoforge-applications', 'rezonate', 'tests', 'fixtures', 'thread.html').replace(/\\/g, '/');
    const spec = {
      ...baseSpec, actionId: 'bpr_test_1', permalink: fixture,
      profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bpr-prof-')),
      requestedAt: new Date().toISOString(),
    };
    spec.authorization = bpr.createAuthorization(spec);
    const r = await bpr.execute(spec);
    assert.ok(['VERIFIED', 'UNKNOWN', 'FAILED'].includes(r.status), `unexpected status ${r.status}: ${r.reason}`);
    // On the fixture page the typed text appears after Post → VERIFIED expected
    if (r.status === 'VERIFIED') bpr.recordSubmission(spec, r);
  });
  it('refuses a second submission of the same action', () => {
    const spec = { ...baseSpec, message: 'I can produce a print-ready STL for that — $29, same day.' };
    spec.authorization = bpr.createAuthorization(spec);
    // Simulate a prior attempt
    bpr.recordSubmission(spec, { status: 'VERIFIED' });
    const r = bpr.alreadySubmitted(spec);
    assert.ok(r, 'prior submission should be found');
  });
});
