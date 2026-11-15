'use strict';

const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
]);

function isPrivateOrReservedIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    if (n === '::1') return true;
    if (n.startsWith('fe80:')) return true; // link-local
    if (n.startsWith('fc') || n.startsWith('fd')) return true; // ULA
    if (n.startsWith('::ffff:')) {
      const v4 = n.slice(7);
      if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
    }
  }
  return false;
}

/**
 * @param {string} urlString
 * @param {{ allowHttp?: boolean }} [opts]
 */
async function assertUrlSafeForProbe(urlString, opts = {}) {
  const allowHttp = Boolean(opts.allowHttp);
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (url.username || url.password) return { ok: false, error: 'credentials_in_url' };
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    return { ok: false, error: allowHttp ? 'unsupported_protocol' : 'https_required' };
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, error: 'blocked_hostname' };
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) return { ok: false, error: 'blocked_ip' };
    return { ok: true, url };
  }
  try {
    const { address } = await dns.lookup(host, { verbatim: true });
    if (isPrivateOrReservedIp(address)) return { ok: false, error: 'blocked_dns_target' };
  } catch {
    return { ok: false, error: 'dns_lookup_failed' };
  }
  return { ok: true, url };
}

module.exports = { assertUrlSafeForProbe, isPrivateOrReservedIp, BLOCKED_HOSTNAMES };