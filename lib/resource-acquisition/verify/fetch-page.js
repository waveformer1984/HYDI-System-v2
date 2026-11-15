'use strict';

const https = require('https');
const http = require('http');
const { assertUrlSafeForProbe } = require('./url-guard');

const DEFAULT_MAX_BYTES = 120000;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

function fetchOnce(url, { timeoutMs, maxBytes, allowHttp }) {
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

    const lib = url.startsWith('https:') ? https : http;
    req = lib.get(url, { headers: { 'User-Agent': 'HYDI-ResourceVerification/1.0' } }, (res) => {
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
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
        if (body.length > maxBytes) res.destroy();
      });
      res.on('end', () => {
        finish({
          ok: true,
          status,
          elapsed_ms: Date.now() - started,
          body: body.slice(0, maxBytes),
          final_url: url,
        });
      });
      res.on('error', (e) =>
        finish({ ok: false, error: e instanceof Error ? e.message : 'error', elapsed_ms: Date.now() - started, final_url: url }),
      );
    });
    req.on('error', (e) =>
      finish({ ok: false, error: e instanceof Error ? e.message : 'error', elapsed_ms: Date.now() - started, final_url: url }),
    );
  });
}

/**
 * Bounded HTTPS fetch (optional HTTP). Redirect hops re-validated via url-guard.
 */
async function fetchPageText(url, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, opts = {}) {
  const allowHttp = opts.allowHttp === true;
  let current = url;
  let hops = 0;
  const started = Date.now();

  while (hops <= MAX_REDIRECTS) {
    // eslint-disable-next-line no-await-in-loop
    const safe = await assertUrlSafeForProbe(current, { allowHttp });
    if (!safe.ok) {
      return { ok: false, error: safe.error, elapsed_ms: Date.now() - started, final_url: current, hops };
    }
    const budget = Math.max(500, timeoutMs - (Date.now() - started));
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchOnce(safe.url.href, { timeoutMs: budget, maxBytes, allowHttp });
    if (res.redirect && res.location) {
      hops += 1;
      try {
        current = new URL(res.location, current).href;
      } catch {
        return { ok: false, error: 'invalid_redirect', elapsed_ms: Date.now() - started, final_url: current, hops };
      }
      continue;
    }
    return { ...res, hops, requested_url: url };
  }
  return { ok: false, error: 'too_many_redirects', elapsed_ms: Date.now() - started, final_url: current, hops };
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