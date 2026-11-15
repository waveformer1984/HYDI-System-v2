'use strict';

const { assertUrlSafeForProbe, isPrivateOrReservedIp } = require('../../lib/resource-acquisition/verify/url-guard');

describe('resource url-guard', () => {
  it('blocks loopback IP literals', async () => {
    const r = await assertUrlSafeForProbe('https://127.0.0.1/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked_ip');
  });

  it('requires HTTPS by default', async () => {
    const r = await assertUrlSafeForProbe('http://example.com/');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('https_required');
  });

  it('allows HTTPS public host after DNS', async () => {
    const r = await assertUrlSafeForProbe('https://example.com/');
    expect(r.ok).toBe(true);
  });

  it('classifies RFC1918', () => {
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('203.0.113.1')).toBe(false);
  });
});