'use strict';

const https = require('https');
const http = require('http');
const { assertUrlSafeForProbe, createPinnedLookup } = require('./url-guard');

const DEFAULT_MAX_BYTES = 120000;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

function fetchOnce(url, { timeoutMs, maxBytes, allowHttp, extraCaPem, pinnedHostname, pinnedAddress, resolvedFamily }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let req;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (req) req.destroy();
      } catch {
        /* noop */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'timeout', elapsed_ms: Date.now() - started, final_url: url });
    }, timeoutMs);

    const requestOpts = {
      headers: { 'User-Agent': 'HYDI-ResourceVerification/1.0' },
      lookup: createPinnedLookup(pinnedHostname, pinnedAddress, resolvedFamily),
    };
    if (url.startsWith('https:') && typeof extraCaPem === 'string' && extraCaPem.trim()) {
      requestOpts.ca = extraCaPem;
    }

    const lib = url.startsWith('https:') ? https : http;
    req = lib.get(url, requestOpts, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        finish({
          ok: false,
          redirect: true,
          status,
          location: res.headers.location,
          elapsed_ms: Date.now() - started,
          final_url: url,
        });
        return;
      }

      const chunks = [];
      let byteLength = 0;
      let truncated = false;

      const onBodyDone = () => {
        const buf = Buffer.concat(chunks);
        finish({
          ok: true,
          status,
          elapsed_ms: Date.now() - started,
          body: buf.toString('utf8'),
          byte_length: buf.length,
          truncated,
          final_url: url,
        });
      };

      res.on('data', (chunk) => {
        if (truncated) return;
        const room = maxBytes - byteLength;
        if (chunk.length <= room) {
          chunks.push(chunk);
          byteLength += chunk.length;
        } else {
          chunks.push(chunk.subarray(0, room));
          byteLength = maxBytes;
          truncated = true;
          try {
            res.destroy();
          } catch {
            /* noop */
          }
          onBodyDone();
        }
      });
      res.on('end', () => {
        if (!settled) onBodyDone();
      });
      res.on('close', () => {
        if (!settled) onBodyDone();
      });
      res.on('error', (e) =>
        finish({ ok: false, error: e instanceof Error ? e.message : 'error', elapsed_ms: Date.now() - started, final_url: url }),
      );
    });
    req.on('error', (e) => {
      const code = e && typeof e === 'object' && e.code ? String(e.code) : '';
      const msg = e instanceof Error ? e.message : String(e);
      finish({
        ok: false,
        error: code && !msg ? code : msg || 'error',
        elapsed_ms: Date.now() - started,
        final_url: url,
      });
    });
  });
}

/**
 * Bounded HTTPS fetch (optional HTTP in tests). Redirect hops re-validated with pinned DNS.
 */
async function fetchPageText(url, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, opts = {}) {
  const allowHttp = opts.allowHttp === true;
  let current = url;
  let hops = 0;
  const started = Date.now();

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const safe = await assertUrlSafeForProbe(current, { allowHttp });
    if (!safe.ok) {
      return { ok: false, error: safe.error, elapsed_ms: Date.now() - started, final_url: current, hops };
    }
    const budget = Math.max(500, timeoutMs - (Date.now() - started));
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchOnce(safe.url.href, {
      timeoutMs: budget,
      maxBytes,
      allowHttp,
      extraCaPem: opts.extraCaPem,
      pinnedHostname: safe.hostname,
      pinnedAddress: safe.resolvedAddress,
      resolvedFamily: safe.resolvedFamily,
    });
    if (res.redirect && res.location) {
      hops += 1;
      if (hops > MAX_REDIRECTS) {
        return {
          ok: false,
          error: 'too_many_redirects',
          elapsed_ms: Date.now() - started,
          final_url: current,
          hops,
        };
      }
      try {
        current = new URL(res.location, current).href;
      } catch {
        return { ok: false, error: 'invalid_redirect', elapsed_ms: Date.now() - started, final_url: current, hops };
      }
      continue;
    }
    return { ...res, hops, requested_url: url };
  }
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().slice(0, 240) : null;
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].trim().slice(0, 400) : null;
}

module.exports = { fetchPageText, extractTitle, extractMetaDescription, MAX_REDIRECTS };