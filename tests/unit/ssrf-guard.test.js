'use strict';

const { assertPublicHttpUrl, isPrivateIP } = require('../../lib/ssrf-guard');

describe('isPrivateIP', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254', // cloud metadata endpoint
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
  ])('flags %s as private', (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2606:4700:4700::1111',
  ])('does not flag %s as private', (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });

  it('does not flag a public 172.x address outside the 172.16/12 block as private', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow(/non-http/i);
  });

  it('rejects an invalid URL', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/invalid url/i);
  });

  it('rejects localhost', async () => {
    await expect(assertPublicHttpUrl('http://localhost:8080/hook')).rejects.toThrow(/localhost/i);
  });

  it('rejects an IP-literal loopback URL', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/hook')).rejects.toThrow(/private|internal/i);
  });

  it('rejects the cloud metadata endpoint by IP literal', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private|internal/i);
  });

  it('rejects a private RFC1918 IP literal', async () => {
    await expect(assertPublicHttpUrl('http://10.0.0.5:9200/_search')).rejects.toThrow(/private|internal/i);
  });

  it('allows a public IP-literal https URL', async () => {
    await expect(assertPublicHttpUrl('https://93.184.216.34/hook')).resolves.toBeUndefined();
  });
});
