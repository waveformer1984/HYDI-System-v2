'use strict';

const {
  validateFetchUrl,
  safePoolHttpGet,
  setPoolFetchDnsForTests,
  resetPoolFetchDnsForTests,
} = require('../../lib/dev-workforce/pool-fetch-guard');

describe('pool http fetch guard', () => {
  afterEach(() => {
    resetPoolFetchDnsForTests();
  });

  const blockedIps = [
    ['127.0.0.1', 'loopback'],
    ['10.0.0.1', '10/8'],
    ['172.16.0.1', '172.16/12'],
    ['192.168.1.1', '192.168/16'],
    ['169.254.169.254', 'link-local metadata'],
    ['100.64.0.1', 'CGNAT tailscale'],
    ['0.0.0.0', '0.0.0.0/8'],
  ];

  it.each(blockedIps)('blocks raw IP %s (%s)', async (ip) => {
    const r = await validateFetchUrl(`http://${ip}/`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_ip');
  });

  it('blocks ::1 and blocked hostname suffixes', async () => {
    expect((await validateFetchUrl('http://[::1]/')).error).toBe('blocked_ip');
    expect((await validateFetchUrl('https://foo.ts.net/x')).error).toBe('blocked_hostname_suffix');
    expect((await validateFetchUrl('https://host.local/x')).error).toBe('blocked_hostname_suffix');
    expect((await validateFetchUrl('https://svc.internal/x')).error).toBe('blocked_hostname_suffix');
    expect((await validateFetchUrl('https://device.lan/x')).error).toBe('blocked_hostname_suffix');
  });

  it('blocks DNS resolving to private address', async () => {
    setPoolFetchDnsForTests(async () => [{ address: '127.0.0.1', family: 4 }]);
    const r = await validateFetchUrl('https://public-looking.example/path');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_dns_target');
  });

  it('blocks redirect to private URL', async () => {
    const r = await safePoolHttpGet('https://example.com/start', {
      httpGet: async () => ({
        status: 302,
        headers: { location: 'http://127.0.0.1/secret' },
        body: Buffer.alloc(0),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_ip');
  });

  it('blocks DNS rebinding on redirect hop', async () => {
    let lookups = 0;
    setPoolFetchDnsForTests(async (host) => {
      lookups += 1;
      if (host === 'rebind.test') {
        if (lookups === 1) return [{ address: '93.184.216.34', family: 4 }];
        return [{ address: '10.0.0.5', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    });
    const r = await safePoolHttpGet('https://rebind.test/', {
      httpGet: async (url) => {
        if (url.hostname === 'rebind.test' && url.pathname === '/') {
          return {
            status: 302,
            headers: { location: 'https://rebind.test/two' },
            body: Buffer.alloc(0),
          };
        }
        return { status: 200, headers: {}, body: Buffer.from('ok') };
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_dns_target');
  });

  it('allows public URL with mocked upstream', async () => {
    const r = await safePoolHttpGet('https://example.com/hello', {
      httpGet: async () => ({
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('hello world'),
      }),
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.bytes).toBe(11);
    expect(r.body_preview).toBe('hello world');
  });
});