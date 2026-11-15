'use strict';

const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

const blockedIpRanges = new net.BlockList();
blockedIpRanges.addSubnet('0.0.0.0', 8, 'ipv4');
blockedIpRanges.addSubnet('10.0.0.0', 8, 'ipv4');
blockedIpRanges.addSubnet('100.64.0.0', 10, 'ipv4');
blockedIpRanges.addSubnet('127.0.0.0', 8, 'ipv4');
blockedIpRanges.addSubnet('169.254.0.0', 16, 'ipv4');
blockedIpRanges.addSubnet('172.16.0.0', 12, 'ipv4');
blockedIpRanges.addSubnet('192.0.0.0', 24, 'ipv4');
blockedIpRanges.addSubnet('192.168.0.0', 16, 'ipv4');
blockedIpRanges.addSubnet('198.18.0.0', 15, 'ipv4');
blockedIpRanges.addSubnet('224.0.0.0', 3, 'ipv4');
blockedIpRanges.addAddress('::', 'ipv6');
blockedIpRanges.addAddress('::1', 'ipv6');
blockedIpRanges.addSubnet('fe80::', 10, 'ipv6');
blockedIpRanges.addSubnet('fc00::', 7, 'ipv6');
blockedIpRanges.addSubnet('64:ff9b::', 96, 'ipv6');

let dnsLookupImpl = dns.lookup;
/** @type {string | null} Jest-only: connect here while guard still pins the validated address. */
let pinnedConnectOverrideForTests = null;

function setDnsLookupForTests(fn) {
  dnsLookupImpl = fn;
}

function resetDnsLookupForTests() {
  dnsLookupImpl = dns.lookup;
  pinnedConnectOverrideForTests = null;
}

function setPinnedConnectOverrideForTests(address) {
  pinnedConnectOverrideForTests = address;
}

function stripIpv6Brackets(host) {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function ipv4MappedEmbedded(ipv6) {
  const n = ipv6.toLowerCase();
  if (n.startsWith('::ffff:')) {
    const tail = n.slice(7);
    if (net.isIPv4(tail)) return tail;
    const hex = tail.replace(/:/g, '');
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      const num = parseInt(hex, 16);
      return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
    }
  }
  return null;
}

function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const embedded = ipv4MappedEmbedded(ip);
  if (embedded && blockedIpRanges.check(embedded, 'ipv4')) return true;
  const family = net.isIP(ip);
  if (!family) return true;
  return blockedIpRanges.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

async function resolveHostAddresses(hostname) {
  const bare = stripIpv6Brackets(hostname);
  if (net.isIP(bare)) return [{ address: bare, family: net.isIP(bare) }];
  const rows = await dnsLookupImpl(bare, { all: true, verbatim: true });
  return rows;
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
  const hostname = url.hostname;
  const hostLower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostLower)) return { ok: false, error: 'blocked_hostname' };

  const ipLiteral = stripIpv6Brackets(hostname);
  if (net.isIP(ipLiteral)) {
    if (isPrivateOrReservedIp(ipLiteral)) return { ok: false, error: 'blocked_ip' };
    return {
      ok: true,
      url,
      hostname,
      resolvedAddress: ipLiteral,
      resolvedFamily: net.isIP(ipLiteral),
    };
  }

  let addresses;
  try {
    addresses = await resolveHostAddresses(hostname);
  } catch {
    return { ok: false, error: 'dns_lookup_failed' };
  }
  if (!addresses.length) return { ok: false, error: 'dns_lookup_failed' };

  for (const row of addresses) {
    if (isPrivateOrReservedIp(row.address)) {
      return { ok: false, error: 'blocked_dns_target' };
    }
  }

  const pick = addresses[0];
  return {
    ok: true,
    url,
    hostname,
    resolvedAddress: pick.address,
    resolvedFamily: pick.family || (net.isIP(pick.address) === 6 ? 6 : 4),
  };
}

function createPinnedLookup(pinnedHostname, pinnedAddress, resolvedFamily) {
  return (a, b, c) => {
    let hostname;
    let options = {};
    let callback;
    if (typeof a === 'string') {
      hostname = a;
      if (typeof b === 'object' && b !== null) options = b;
      callback = typeof c === 'function' ? c : b;
    } else if (a && typeof a === 'object') {
      options = a;
      hostname = a.hostname || a.host || b;
      callback = typeof c === 'function' ? c : b;
    } else {
      hostname = b;
      callback = c;
    }
    if (typeof callback !== 'function') {
      return;
    }
    const pin = String(pinnedHostname).toLowerCase();
    if (String(hostname).toLowerCase() !== pin) {
      callback(new Error('hostname_mismatch'));
      return;
    }
    const connectAddress = pinnedConnectOverrideForTests || pinnedAddress;
    const family = resolvedFamily === 6 ? 6 : 4;
    if (options && options.all) {
      callback(null, [{ address: connectAddress, family }]);
      return;
    }
    callback(null, connectAddress, family);
  };
}

module.exports = {
  assertUrlSafeForProbe,
  isPrivateOrReservedIp,
  createPinnedLookup,
  setDnsLookupForTests,
  resetDnsLookupForTests,
  setPinnedConnectOverrideForTests,
  stripIpv6Brackets,
  BLOCKED_HOSTNAMES,
};