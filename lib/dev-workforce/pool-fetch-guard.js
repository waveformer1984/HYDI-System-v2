'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const {
  isPrivateOrReservedIp,
  createPinnedLookup,
  setDnsLookupForTests,
  resetDnsLookupForTests,
  stripIpv6Brackets,
} = require('../resource-acquisition/verify/url-guard');

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set([80, 443]);

const BLOCKED_HOST_SUFFIXES = ['.ts.net', '.local', '.internal', '.lan'];

let dnsLookupImpl = require('dns').promises.lookup;

function setPoolFetchDnsForTests(fn) {
  dnsLookupImpl = fn;
}

function resetPoolFetchDnsForTests() {
  dnsLookupImpl = require('dns').promises.lookup;
  resetDnsLookupForTests();
}

function blockedHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return 'invalid_hostname';
  if (h === 'localhost' || h.endsWith('.localhost')) return 'blocked_hostname';
  for (const suf of BLOCKED_HOST_SUFFIXES) {
    if (h === suf.slice(1) || h.endsWith(suf)) return 'blocked_hostname_suffix';
  }
  return null;
}

function allowedPort(url) {
  const p = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(p)) return false;
  if (url.protocol === 'http:' && p !== 80) return false;
  if (url.protocol === 'https:' && p !== 443) return false;
  return true;
}

async function resolveHostAddresses(hostname) {
  const bare = stripIpv6Brackets(hostname);
  if (net.isIP(bare)) return [{ address: bare, family: net.isIP(bare) }];
  return dnsLookupImpl(bare, { all: true, verbatim: true });
}

/**
 * @param {string} urlString
 * @returns {Promise<{ok:true, url:URL, hostname:string, pinnedAddress:string, family:number}|{ok:false, error:string}>}
 */
async function validateFetchUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'unsupported_protocol' };
  }
  if (url.username || url.password) return { ok: false, error: 'credentials_in_url' };
  if (!allowedPort(url)) return { ok: false, error: 'blocked_port' };

  const hostname = url.hostname;
  const hostRule = blockedHostname(hostname);
  if (hostRule) return { ok: false, error: hostRule };

  const literal = stripIpv6Brackets(hostname);
  if (net.isIP(literal)) {
    if (isPrivateOrReservedIp(literal)) return { ok: false, error: 'blocked_ip' };
    return {
      ok: true,
      url,
      hostname,
      pinnedAddress: literal,
      family: net.isIP(literal),
    };
  }

  let rows;
  try {
    rows = await resolveHostAddresses(hostname);
  } catch {
    return { ok: false, error: 'dns_lookup_failed' };
  }
  if (!rows.length) return { ok: false, error: 'dns_lookup_failed' };
  for (const row of rows) {
    if (isPrivateOrReservedIp(row.address)) {
      return { ok: false, error: 'blocked_dns_target' };
    }
  }
  const pick = rows[0];
  const family = pick.family || (net.isIP(pick.address) === 6 ? 6 : 4);
  return {
    ok: true,
    url,
    hostname,
    pinnedAddress: pick.address,
    family,
  };
}

function readBodyLimited(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    res.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy();
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

/**
 * Pinned GET — connects only to validated IP (DNS rebinding safe).
 */
function pinnedGet(url, pinnedAddress, family, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('timeout'));
    }, timeoutMs);
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        host: pinnedAddress,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Host: url.hostname,
          Accept: 'text/html,text/plain,application/json',
          'User-Agent': 'HYDI-Pool-Scout/1.0',
        },
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        lookup: createPinnedLookup(url.hostname, pinnedAddress, family),
      },
      async (res) => {
        clearTimeout(timer);
        try {
          const body = await readBodyLimited(res, MAX_BODY_BYTES);
          resolve({ status: res.statusCode || 0, headers: res.headers, body });
        } catch (e) {
          reject(e);
        }
      },
    );
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end();
  });
}

function redirectUrl(fromUrl, location) {
  try {
    return new URL(location, fromUrl);
  } catch {
    return null;
  }
}

/**
 * @param {string} startUrl
 * @param {{ httpGet?: typeof pinnedGet }} [deps]
 */
async function safePoolHttpGet(startUrl, deps = {}) {
  const get = deps.httpGet || pinnedGet;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const v = await validateFetchUrl(current);
    if (!v.ok) return { ok: false, error: v.error, url: current };
    const res = await get(v.url, v.pinnedAddress, v.family, FETCH_TIMEOUT_MS);
    const status = res.status;
    if (status >= 300 && status < 400 && res.headers.location) {
      if (hop >= MAX_REDIRECTS) return { ok: false, error: 'too_many_redirects', url: current };
      const next = redirectUrl(v.url.href, res.headers.location);
      if (!next) return { ok: false, error: 'invalid_redirect', url: current };
      current = next.href;
      continue;
    }
    const text = res.body.toString('utf8').replace(/\0/g, '');
    return {
      ok: status >= 200 && status < 300,
      status,
      url: v.url.href,
      pinned: v.pinnedAddress,
      bytes: res.body.length,
      truncated: false,
      body_preview: text.slice(0, 8000),
    };
  }
  return { ok: false, error: 'redirect_loop', url: startUrl };
}

module.exports = {
  validateFetchUrl,
  safePoolHttpGet,
  pinnedGet,
  isPrivateOrReservedIp,
  blockedHostname,
  setPoolFetchDnsForTests,
  resetPoolFetchDnsForTests,
  MAX_BODY_BYTES,
  FETCH_TIMEOUT_MS,
};