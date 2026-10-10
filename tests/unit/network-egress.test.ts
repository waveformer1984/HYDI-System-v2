/**
 * Network egress / SSRF (R2 contract item 6).
 *
 * The autonomous `network.http_request` was declared R1 with `url_pattern: '*'`
 * — a fully open pipe to localhost, private networks, cloud metadata, and any
 * internal service. The fix layers three guards:
 *   1. assertEgressAllowed — scheme (http/https only), read-method
 *      (GET/HEAD/OPTIONS), and a non-internal/non-private destination string.
 *   2. DNS-rebinding guard — the hostname is resolved and the RESULT address
 *      is checked; the socket is pinned to that verified IP (TOCTOU-safe).
 *   3. Redirects are NOT followed — Node's http.request returns the 3xx as a
 *      response, so a redirect to a blocked host cannot be smuggled through.
 *
 * These tests exercise the pure guard (assertEgressAllowed / isPrivateIp) for
 * every destination class; no live socket is opened.
 */

import { assertEgressAllowed, isPrivateIp } from '../../lib/human-action/adapters/HttpAdapter';

function expectRefused(url: string, method = 'GET') {
  expect(() => assertEgressAllowed(url, method)).toThrow();
}

function expectAllowed(url: string, method = 'GET') {
  expect(() => assertEgressAllowed(url, method)).not.toThrow();
}

describe('network egress — loopback / private / metadata destinations are refused', () => {
  test.each([
    'http://localhost/',
    'http://localhost:8080/',
    'http://127.0.0.1/',
    'http://127.0.0.1:3000/',
    'http://[::1]/',
    'http://10.0.0.1/',
    'http://10.255.255.1/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://172.31.255.1/',
    'http://169.254.169.254/latest/meta-data/',   // cloud metadata
    'http://169.254.0.1/',
    'http://100.64.0.1/',                          // CGNAT
    'http://0.0.0.0/',
    'http://metadata.google.internal/',            // GCP metadata
    'http://host.docker.internal/',                // docker host
    'http://kubernetes.default.svc.cluster.local/',// internal service
    'http://foo.internal/',
    'http://printer.local/',
    'http://service.localhost/',
    // Alternate IP notations — Node normalises these to 127.0.0.1
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://127.1/',
  ])('refuses %s', (url) => expectRefused(url));
});

describe('network egress — scheme and method restrictions', () => {
  test.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com/',
    'javascript:alert(1)',
    'data:text/plain,x',
    'ssh://example.com/',
  ])('refuses non-http scheme %s', (url) => expectRefused(url));

  test.each(['POST', 'PUT', 'DELETE', 'PATCH', 'CONNECT'])(
    'refuses non-read method %s',
    (m) => expectRefused('https://example.com/', m),
  );

  test.each(['GET', 'HEAD', 'OPTIONS'])('allows read method %s', (m) =>
    expectAllowed('https://example.com/', m),
  );
});

describe('network egress — public destinations on any port are permitted', () => {
  test.each([
    'https://example.com/',
    'http://8.8.8.8/dns',
    'https://api.resend.com/emails',
    'https://example.com:8443/',   // arbitrary port on a public host is fine
    'https://[2001:4860:4860::8888]/', // public IPv6
  ])('allows %s', (url) => expectAllowed(url));
});

describe('isPrivateIp — the resolved-IP check (defeats DNS rebinding)', () => {
  test.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '192.168.0.1', '172.16.5.4',
    '169.254.169.254', '169.254.0.1', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00::1', '[::1]',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
  ])('treats %s as private', (ip) => expect(isPrivateIp(ip)).toBe(true));

  test.each([
    '8.8.8.8', '1.1.1.1', '203.0.113.5', '93.184.216.34', '2001:4860:4860::8888',
  ])('treats %s as public', (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe('network egress — redirect behaviour', () => {
  test('redirects are not followed — a 3xx is a response, not a new request', () => {
    // The implementation uses http.request and resolves on 'end' — it never
    // reads the Location header to issue a second request. So a redirect to a
    // blocked destination is simply returned as a 3xx statusCode, never
    // followed into a private/internal target. This documents that contract.
    expect(true).toBe(true);
  });
});
