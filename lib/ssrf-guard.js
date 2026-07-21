'use strict';

/**
 * Minimal SSRF guard for outbound webhook/fetch calls whose target URL is
 * supplied by upstream request params (e.g. HeidiActionLayer's
 * `send_webhook` action). Resolves the hostname and rejects anything that
 * points at loopback, link-local, private (RFC1918/RFC4193), or the cloud
 * metadata endpoint, so a caller can't use this codebase's own outbound
 * fetch capability to reach internal-only services.
 *
 * Not a substitute for network-level egress control — this only blocks the
 * common, obvious SSRF shapes reachable via IP-literal or DNS-resolvable
 * hostnames.
 */

const dns = require('dns').promises;
const net = require('net');

const IPV4_PRIVATE_PREFIXES = [
  /^127\./,            // loopback
  /^10\./,             // RFC1918
  /^192\.168\./,       // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16.0.0/12
  /^169\.254\./,       // link-local (includes cloud metadata 169.254.169.254)
  /^0\./,              // "this" network
];

function isPrivateIPv4(ip) {
  return IPV4_PRIVATE_PREFIXES.some((re) => re.test(ip));
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||           // loopback
    normalized.startsWith('fe80:') || // link-local
    normalized.startsWith('fc') ||    // unique local (fc00::/7)
    normalized.startsWith('fd') ||
    normalized.startsWith('::ffff:127.') // IPv4-mapped loopback
  );
}

function isPrivateIP(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP at all — fail closed
}

/**
 * Throws if `urlString` is not a safe public http(s) URL to fetch.
 * @param {string} urlString
 */
async function assertPublicHttpUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked non-http(s) URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname === 'localhost') {
    throw new Error('Blocked request to localhost');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked request to private/internal address: ${hostname}`);
    }
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  if (addresses.length === 0 || addresses.some((a) => isPrivateIP(a.address))) {
    throw new Error(`Blocked request to private/internal address for hostname: ${hostname}`);
  }
}

module.exports = { assertPublicHttpUrl, isPrivateIP };
