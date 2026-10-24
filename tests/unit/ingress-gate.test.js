'use strict';

const {
  decideIngress,
  isInternalIp,
  isPublicPath,
  classify,
  hasFunnelHeader,
} = require('../../lib/security/ingressGate');

const env = {};
const NGROK = 'evelyne-unpreying-angrily.ngrok-free.dev';
const req = (pathname, headers) => ({ pathname, headers });

describe('isInternalIp', () => {
  test.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.100',
    '100.87.215.90', '100.118.182.126', '169.254.1.1', '::1', '::ffff:127.0.0.1',
    'fd7a:115c:a1e0::1', 'fe80::1', '[::1]', '192.168.1.5:51234',
  ])('%s is internal', (ip) => expect(isInternalIp(ip)).toBe(true));

  test.each([
    '173.174.244.48', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2600:1700::1', '', 'unknown', '999.1.1.1',
  ])('%s is not internal', (ip) => expect(isInternalIp(ip)).toBe(false));
});

describe('classify', () => {
  test('direct local and LAN requests are internal', () => {
    expect(classify({ host: 'localhost:3000' }, env).internal).toBe(true);
    expect(classify({ host: '127.0.0.1:3000' }, env).internal).toBe(true);
    expect(classify({ host: '192.168.1.100:3000' }, env).internal).toBe(true);
  });

  test('tailnet serve (ts.net host, tailnet client IP) is internal', () => {
    expect(classify({ host: 'heidi-pc.tailc50af2.ts.net', 'x-forwarded-for': '100.87.215.90' }, env).internal).toBe(true);
  });

  test('ngrok with its own host is external', () => {
    expect(classify({ host: NGROK, 'x-forwarded-for': '173.174.244.48' }, env).internal).toBe(false);
  });

  test('ngrok with host rewritten to localhost is still external (public forwarded hop)', () => {
    expect(classify({ host: 'localhost:3000', 'x-forwarded-for': '173.174.244.48' }, env).internal).toBe(false);
  });

  test('a client spoofing a private X-Forwarded-For is still caught by the hop the tunnel appends', () => {
    expect(classify({ host: NGROK, 'x-forwarded-for': '127.0.0.1, 173.174.244.48' }, env).internal).toBe(false);
    expect(classify({ host: 'localhost', 'x-forwarded-for': '10.0.0.1, 8.8.8.8' }, env).internal).toBe(false);
  });

  test('Funnel (ts.net host, public client IP) is external', () => {
    expect(classify({ host: 'heidi-pc.tailc50af2.ts.net', 'x-forwarded-for': '8.8.8.8' }, env).internal).toBe(false);
  });

  test('an explicit Funnel header is external even when every visible hop is internal', () => {
    const headers = {
      host: 'localhost:3000',
      'x-forwarded-for': '100.87.215.90',
      'Tailscale-Funnel-Request': '1',
    };
    expect(hasFunnelHeader(headers)).toBe(true);
    expect(classify(headers, env)).toMatchObject({ internal: false, reason: 'Tailscale Funnel request' });
  });

  test('RFC 7239 Forwarded and X-Real-IP are honoured', () => {
    expect(classify({ host: 'localhost', forwarded: 'for=8.8.8.8;proto=https' }, env).internal).toBe(false);
    expect(classify({ host: 'localhost', forwarded: 'for="[2600:1700::1]"' }, env).internal).toBe(false);
    expect(classify({ host: 'localhost', 'x-real-ip': '8.8.8.8' }, env).internal).toBe(false);
  });

  test('HYDI_TRUSTED_HOSTS adds a host, but a public hop still wins', () => {
    const e = { HYDI_TRUSTED_HOSTS: 'hydi.local:3000, frank' };
    expect(classify({ host: 'hydi.local' }, e).internal).toBe(true);
    expect(classify({ host: 'frank:3000' }, e).internal).toBe(true);
    expect(classify({ host: 'frank', 'x-forwarded-for': '8.8.8.8' }, e).internal).toBe(false);
  });

  test('works with a Headers object', () => {
    const h = new Headers({ host: NGROK, 'x-forwarded-for': '173.174.244.48' });
    expect(classify(h, env).internal).toBe(false);
  });
});

describe('isPublicPath', () => {
  test.each([
    '/api/billing/webhook', '/api/galactic-bytes/checkout',
    '/galactic-bytes', '/galactic-bytes/', '/galactic-bytes/success', '/galactic-bytes/cancel',
    '/_next/static/chunks/main.js', '/_next/image', '/favicon.ico', '/robots.txt',
  ])('%s is public', (p) => expect(isPublicPath(p, env)).toBe(true));

  test.each([
    '/', '/heidi', '/api/chat', '/api/chat/route', '/api/health', '/api/devices', '/api/heartbeat',
    '/api/status/system', '/api/mobile-status', '/api/proposals', '/api/actions', '/api/coo',
    '/api/board', '/api/phone/pair', '/api/phone/revenue-summary', '/api/mobile-ops/fabric',
    '/api/revenue/service-switch', '/api/revenue/first-sale-readiness',
    '/api/ping', '/api/webhooks/stripe', '/api/stripe-connect-webhook',
    '/api/billing/checkout', '/api/billing/catalog', '/api/revenue/jobs',
    '/api/revenue/jobs/job_1/approve', '/api/revenue/jobs/job_1/reconcile',
    '/api/billing/admin/revenue', '/api/heidi-mobile/session', '/api/secure-credential-input',
    '/billing-admin', '/ops', '/coo', '/console', '/hydi-chat.html', '/revenue-dashboard.html',
    '/services/checkpoint-audit', '/services/model-prep/success', '/pricing', '/billing',
    '/services/../api/chat', '/services/%2e%2e/api/chat', '/api/revenue/jobs/a/../../chat',
    '/services//x', '/pricing.html',
  ])('%s is not public', (p) => expect(isPublicPath(p, env)).toBe(false));

  test('HYDI_PUBLIC_PATHS can narrow but never widen the hard-coded maximum', () => {
    const e = { HYDI_PUBLIC_PATHS: '/api/billing/webhook,/api/chat' };
    expect(isPublicPath('/api/billing/webhook', e)).toBe(true);
    expect(isPublicPath('/api/chat', e)).toBe(false);
    expect(isPublicPath('/galactic-bytes', e)).toBe(false);
  });
});

describe('decideIngress', () => {
  const pub = { host: NGROK, 'x-forwarded-for': '173.174.244.48' };
  const funnel = {
    host: 'heidi-pc.tailc50af2.ts.net',
    'x-forwarded-for': '173.174.244.48',
    'tailscale-funnel-request': '1',
  };

  test('public request to an operator route is refused', () => {
    expect(decideIngress(req('/api/chat', pub), env)).toMatchObject({ allow: false, internal: false });
    expect(decideIngress(req('/', pub), env).allow).toBe(false);
    expect(decideIngress(req('/heidi', pub), env).allow).toBe(false);
  });

  test.each([
    '/galactic-bytes',
    '/galactic-bytes/success',
    '/galactic-bytes/cancel',
    '/api/galactic-bytes/checkout',
    '/api/billing/webhook',
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/favicon.ico',
    '/robots.txt',
  ])('Funnel allows the Galactic Bytes public surface: %s', (path) => {
    expect(decideIngress(req(path, funnel), env)).toMatchObject({ allow: true, internal: false });
  });

  test.each([
    '/', '/board', '/api/board', '/heidi', '/ops', '/api/chat',
    '/api/phone/pair', '/api/phone/revenue-summary',
    '/api/mobile-ops/fabric', '/api/mobile-ops/jobs', '/api/mobile-ops/run',
    '/api/billing/admin/revenue', '/billing-admin', '/api/actions',
    '/api/revenue/jobs', '/services/model-prep', '/api/health',
  ])('Funnel denies private route even if it has a valid application token: %s', (path) => {
    const headers = { ...funnel, authorization: 'Bearer valid-but-irrelevant' };
    expect(decideIngress(req(path, headers), env)).toMatchObject({ allow: false, internal: false });
  });

  test.each([
    '/board', '/api/phone/pair', '/api/phone/revenue-summary',
    '/api/mobile-ops/fabric', '/api/billing/admin/revenue', '/heidi',
  ])('direct tailnet requests remain internal and allowed: %s', (path) => {
    const tailnet = { host: 'heidi-pc.tailc50af2.ts.net', 'x-forwarded-for': '100.87.215.90' };
    expect(decideIngress(req(path, tailnet), env)).toMatchObject({ allow: true, internal: true });
  });

  test('/api/phone/pair is refused when Funnel forwarded headers reach a loopback host', () => {
    const headers = {
      host: 'localhost:3000',
      'x-forwarded-for': '100.87.215.90',
      'tailscale-funnel': 'true',
    };
    expect(decideIngress(req('/api/phone/pair', headers), env)).toMatchObject({ allow: false, internal: false });
  });

  test('HYDI_INGRESS_GATE=off cannot expose a private route to public ingress', () => {
    expect(decideIngress(req('/api/chat', pub), { HYDI_INGRESS_GATE: 'off' }).allow).toBe(false);
  });
});
