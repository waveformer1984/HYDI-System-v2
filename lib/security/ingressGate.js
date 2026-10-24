'use strict';

/**
 * Public-ingress gate. Decides whether a request came from inside (this PC,
 * the LAN, the tailnet) or from the public internet (an ngrok tunnel,
 * Tailscale Funnel, a port forward), and limits public requests to the few
 * paths a customer or Stripe needs. Everything else answers 404 to the
 * outside, so the operator dashboard, chat, status, approvals and every
 * operator API stay reachable only from your own devices.
 *
 * How "inside" is decided (proxy.ts passes the headers in):
 *   - Every X-Forwarded-For / X-Real-IP / Forwarded hop must be a
 *     loopback, private (RFC 1918), link-local or tailnet (100.64.0.0/10)
 *     address. Tunnels append the real client's public IP, and a client
 *     can't remove a hop the tunnel appended, so any public hop means
 *     "outside" even when the tunnel rewrites Host to localhost.
 *   - The Host must be loopback, a private-IP literal, a *.ts.net tailnet
 *     name, or a host listed in HYDI_TRUSTED_HOSTS. A public hostname
 *     (an ngrok domain, a real domain) is outside.
 * Funnel shares the *.ts.net host with tailnet serve, but its forwarded
 * hop is the public client IP, so it lands outside too.
 *
 * HYDI_PUBLIC_PATHS may narrow this list, but cannot widen it. Public ingress
 * cannot be disabled with an environment switch: a Funnel request always
 * remains constrained to the hard-coded maximum below.
 */

const DEFAULT_PUBLIC_EXACT = [
  // Galactic Bytes checkout and its signature-verified Stripe webhook.
  '/api/billing/webhook',
  '/api/galactic-bytes/checkout',
  '/galactic-bytes',
  '/favicon.ico',
  '/robots.txt',
];

const DEFAULT_PUBLIC_PREFIXES = [
  '/galactic-bytes/',
  '/_next/',
];

function stripPort(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const i = h.lastIndexOf(':');
  return i > -1 && h.indexOf(':') === i ? h.slice(0, i) : h;
}

function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/** Loopback, RFC 1918, link-local, CGNAT/tailnet (100.64/10), or IPv6 equivalents. */
function isInternalIp(raw) {
  let ip = String(raw || '').trim().toLowerCase();
  if (!ip) return false;
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']'));
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const v4 = parseIPv4(ip);
  if (v4) {
    const [a, b] = v4;
    return a === 127 || a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (!ip.includes(':')) return false;
  if (ip === '::1') return true;
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique-local (tailnet IPv6 fd7a:115c:a1e0::/48)
    || (first & 0xffc0) === 0xfe80; // fe80::/10 link-local
}

/** Every hop the request passed through, from all forwarding headers. */
function forwardedHops(headers) {
  const get = (n) => headerValue(headers, n);
  const hops = [];
  for (const part of String(get('x-forwarded-for')).split(',')) if (part.trim()) hops.push(part.trim());
  if (String(get('x-real-ip')).trim()) hops.push(String(get('x-real-ip')).trim());
  for (const m of String(get('forwarded')).matchAll(/for=("?)([^;,"]+)\1/gi)) hops.push(m[2]);
  return hops;
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? headers[key] || '' : '';
}

function hasFunnelHeader(headers) {
  if (!headers) return false;
  if (typeof headers.entries === 'function') {
    for (const [name] of headers.entries()) {
      if (name.toLowerCase().startsWith('tailscale-funnel')) return true;
    }
    return false;
  }
  return Object.keys(headers).some((name) => name.toLowerCase().startsWith('tailscale-funnel'));
}

function trustedHosts(env) {
  return String(env.HYDI_TRUSTED_HOSTS || '').split(',').map((h) => stripPort(h)).filter(Boolean);
}

function isTrustedHost(host, env) {
  const h = stripPort(host);
  if (!h) return true; // HTTP/1.0 with no Host: only a local client does this
  if (h === 'localhost' || h === '[::1]' || h === '::1') return true;
  if (isInternalIp(h)) return true;
  if (h.endsWith('.ts.net')) return true;
  return trustedHosts(env).includes(h);
}

/** @returns {{ internal: boolean, reason: string }} */
function classify(headers, env = process.env) {
  const get = (n) => headerValue(headers, n);
  if (hasFunnelHeader(headers)) return { internal: false, reason: 'Tailscale Funnel request' };
  for (const hop of forwardedHops(headers)) {
    if (!isInternalIp(hop)) return { internal: false, reason: `public forwarded hop ${hop}` };
  }
  const host = get('host');
  if (!isTrustedHost(host, env)) return { internal: false, reason: `public host ${stripPort(host)}` };
  return { internal: true, reason: 'internal' };
}

function publicPathConfig(env) {
  const custom = String(env.HYDI_PUBLIC_PATHS || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('/'));
  if (!custom.length) return { exact: DEFAULT_PUBLIC_EXACT, prefixes: DEFAULT_PUBLIC_PREFIXES };
  return {
    exact: DEFAULT_PUBLIC_EXACT.filter((path) => custom.includes(path)),
    prefixes: DEFAULT_PUBLIC_PREFIXES.filter((path) => custom.includes(path)),
  };
}

function isPublicPath(pathname, env = process.env) {
  let p = String(pathname || '/');
  try { p = decodeURIComponent(p); } catch { return false; }
  if (p.includes('..') || p.includes('\\') || p.includes('//')) return false;
  const cfg = publicPathConfig(env);
  const bare = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  if (cfg.exact.includes(bare)) return true;
  if (cfg.prefixes.some((pre) => p.startsWith(pre))) return true;
  return false;
}

/**
 * @param {{ pathname: string, headers: Headers|Record<string,string> }} req
 * @returns {{ allow: boolean, internal: boolean, reason: string }}
 */
function decideIngress(req, env = process.env) {
  const c = classify(req.headers, env);
  if (c.internal) return { allow: true, internal: true, reason: c.reason };
  if (isPublicPath(req.pathname, env)) return { allow: true, internal: false, reason: 'public path' };
  return { allow: false, internal: false, reason: c.reason };
}

module.exports = {
  decideIngress,
  classify,
  isPublicPath,
  isInternalIp,
  isTrustedHost,
  hasFunnelHeader,
  DEFAULT_PUBLIC_EXACT,
  DEFAULT_PUBLIC_PREFIXES,
};
