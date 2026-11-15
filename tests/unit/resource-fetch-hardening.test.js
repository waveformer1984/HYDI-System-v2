'use strict';

const http = require('http');
const https = require('https');
const {
  assertUrlSafeForProbe,
  isPrivateOrReservedIp,
  setDnsLookupForTests,
  resetDnsLookupForTests,
  setPinnedConnectOverrideForTests,
} = require('../../lib/resource-acquisition/verify/url-guard');
const { fetchPageText } = require('../../lib/resource-acquisition/verify/fetch-page');
const { fetchUrlMeta } = require('../../lib/resource-acquisition/live-fetch');

const PUBLIC_STUB = '203.0.113.50';
const PUBLIC_STUB_B = '203.0.113.77';

function withHttpServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen({ host: '127.0.0.1', port: 0 }, async () => {
      try {
        const port = server.address().port;
        await fn(port, server);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

function selfSignedTlsMaterials() {
  return require('../fixtures/resource-tls/materials');
}

function withHttpsServer(handler, fn) {
  const tls = selfSignedTlsMaterials();
  return new Promise((resolve, reject) => {
    const server = https.createServer(tls, handler);
    server.listen({ host: '127.0.0.1', port: 0 }, async () => {
      try {
        const port = server.address().port;
        await fn(port, server);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
    server.on('error', reject);
  });
}

describe('resource fetch + url-guard hardening', () => {
  afterEach(() => {
    resetDnsLookupForTests();
  });

  it('stubbed DNS allows public address for guard', async () => {
    setDnsLookupForTests(async () => [{ address: PUBLIC_STUB, family: 4 }]);
    const r = await assertUrlSafeForProbe('https://stub-public.example/', { allowHttp: true });
    expect(r.ok).toBe(true);
    expect(r.resolvedAddress).toBe(PUBLIC_STUB);
  });

  it('blocks when any A record is private', async () => {
    setDnsLookupForTests(async () => [
      { address: PUBLIC_STUB, family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const r = await assertUrlSafeForProbe('https://mixed.example/', { allowHttp: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_dns_target');
  });

  const blockedSamples = [
    ['0.0.0.0', true],
    ['10.0.0.1', true],
    ['100.64.0.1', true],
    ['127.0.0.1', true],
    ['169.254.1.1', true],
    ['172.16.0.1', true],
    ['192.0.0.1', true],
    ['192.168.1.1', true],
    ['198.18.0.1', true],
    ['224.0.0.1', true],
    ['::', true],
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['64:ff9b::1', true],
    ['::ffff:127.0.0.1', true],
    ['203.0.113.1', false],
    ['2001:db8::1', false],
  ];

  it.each(blockedSamples)('IP classification %s blocked=%s', (ip, blocked) => {
    expect(isPrivateOrReservedIp(ip)).toBe(blocked);
  });

  it('classifies bracketed IPv6 literal hostname', async () => {
    const r = await assertUrlSafeForProbe('https://[::1]/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_ip');
  });

  it('timeout when server accepts and never responds', async () => {
    await withHttpServer(
      () => {},
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB, family: 4 }]);
        setPinnedConnectOverrideForTests('127.0.0.1');
        const t0 = Date.now();
        const r = await fetchPageText(`http://hang.localhost:${port}/hang`, 600, 4096, { allowHttp: true });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(r.ok).toBe(false);
        expect(r.error).toBe('timeout');
      },
    );
  });

  it('oversize body returns truncated within timeout', async () => {
    const big = 'x'.repeat(9000);
    await withHttpServer(
      (req, res) => {
        res.writeHead(200);
        res.end(big);
      },
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB_B, family: 4 }]);
        setPinnedConnectOverrideForTests('127.0.0.1');
        const r = await fetchPageText(`http://big.localhost:${port}/`, 3000, 1000, { allowHttp: true });
        expect(r.ok).toBe(true);
        expect(r.truncated).toBe(true);
        expect(r.byte_length).toBeLessThanOrEqual(1000);
        expect(Buffer.byteLength(r.body, 'utf8')).toBeLessThanOrEqual(1000);
      },
    );
  });

  it('redirect hop 2 to private IP is blocked', async () => {
    await withHttpServer(
      (req, res) => {
        if (req.url === '/') {
          res.writeHead(302, { Location: 'http://127.0.0.1:9/private' });
          res.end();
          return;
        }
        res.end('nope');
      },
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB, family: 4 }]);
        setPinnedConnectOverrideForTests('127.0.0.1');
        const r = await fetchPageText(`http://redirect.localhost:${port}/`, 4000, 4096, { allowHttp: true });
        expect(r.ok).toBe(false);
        expect(r.error).toBe('blocked_ip');
      },
    );
  });

  it('returns too_many_redirects after 6 redirects', async () => {
    let redirects = 0;
    await withHttpServer(
      (req, res) => {
        redirects += 1;
        if (redirects <= 6) {
          res.writeHead(302, { Location: `/r${redirects}` });
          res.end();
          return;
        }
        res.end('done');
      },
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB, family: 4 }]);
        setPinnedConnectOverrideForTests('127.0.0.1');
        const r = await fetchPageText(`http://loop.localhost:${port}/r0`, 5000, 4096, { allowHttp: true });
        expect(r.ok).toBe(false);
        expect(r.error).toBe('too_many_redirects');
        expect(r.hops).toBeGreaterThan(5);
      },
    );
  });

  it('rebinding: pinned public IP does not reach localhost server', async () => {
    let hits = 0;
    await withHttpServer(
      (req, res) => {
        hits += 1;
        res.end('secret');
      },
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB, family: 4 }]);
        const r = await fetchPageText(`http://rebind.example:${port}/`, 2500, 4096, { allowHttp: true });
        expect(hits).toBe(0);
        expect(r.ok).toBe(false);
      },
    );
  });

  it('live-fetch rejects loopback URL', async () => {
    const r = await fetchUrlMeta('http://127.0.0.1:1/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('https_required');
  });

  it('https pinned fetch reaches local fixture server', async () => {
    await withHttpsServer(
      (req, res) => {
        res.end('tiny');
      },
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB_B, family: 4 }]);
        setPinnedConnectOverrideForTests('127.0.0.1');
        const page = await fetchPageText(`https://live-huge.localhost:${port}/`, 5000, 4096, {
          allowHttp: false,
          rejectUnauthorized: false,
        });
        expect(page.ok).toBe(true);
        expect(page.body).toBe('tiny');
      },
    );
  });

  it('live-fetch resolves oversize HTTPS page with truncation', async () => {
    const payload = 'z'.repeat(300000);
    await withHttpsServer(
      (req, res) => {
        res.writeHead(200);
        res.end(payload);
      },
      async (port) => {
        setDnsLookupForTests(async () => [{ address: PUBLIC_STUB_B, family: 4 }]);
        setPinnedConnectOverrideForTests('127.0.0.1');
        const r = await fetchUrlMeta(`https://live-huge.localhost:${port}/big`, { rejectUnauthorized: false });
        expect(r.ok).toBe(true);
        expect(r.truncated).toBe(true);
        expect(r.content_length_seen).toBeLessThanOrEqual(256000);
      },
    );
  });
});