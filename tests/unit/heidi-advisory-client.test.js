'use strict';

const http = require('http');
const { advisoryRequest, advisoryBaseUrl } = require('../../lib/governance/heidi-advisory-client');

describe('heidi-advisory-client', () => {
  let server;
  let port;
  let seenAuth;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      seenAuth = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => { server.close(done); });

  it('refuses when HEIDI_ADMIN_TOKEN is unset', async () => {
    const r = await advisoryRequest('/api/decisions/pending', { env: { HEIDI_ADVISORY_URL: `http://127.0.0.1:${port}` } });
    expect(r.status).toBe(503);
  });

  it('sends Bearer token server-side', async () => {
    seenAuth = null;
    const r = await advisoryRequest('/api/decisions/pending', {
      env: {
        HEIDI_ADVISORY_URL: `http://127.0.0.1:${port}`,
        HEIDI_ADMIN_TOKEN: 'test-admin-token',
      },
    });
    expect(r.ok).toBe(true);
    expect(seenAuth).toBe('Bearer test-admin-token');
  });

  it('advisoryBaseUrl honors HEIDI_ADVISORY_URL', () => {
    expect(advisoryBaseUrl({ HEIDI_ADVISORY_URL: 'http://127.0.0.1:3461' })).toBe('http://127.0.0.1:3461');
  });

  it('rejects non-allowlisted advisory paths', async () => {
    const r = await advisoryRequest('/api/../../evil', {
      env: { HEIDI_ADVISORY_URL: `http://127.0.0.1:${port}`, HEIDI_ADMIN_TOKEN: 'tok' },
    });
    expect(r.status).toBe(400);
  });
});
