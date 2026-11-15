'use strict';

const https = require('https');
const http = require('http');

function fetchPageText(url, timeoutMs = 8000, maxBytes = 120000) {
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
      finish({ ok: false, error: 'timeout', elapsed_ms: Date.now() - started });
    }, timeoutMs);

    try {
      const lib = url.startsWith('https:') ? https : http;
      req = lib.get(url, { headers: { 'User-Agent': 'HYDI-ResourceVerification/1.0' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString('utf8');
          if (body.length > maxBytes) res.destroy();
        });
        res.on('end', () => {
          finish({
            ok: true,
            status: res.statusCode,
            elapsed_ms: Date.now() - started,
            body,
            final_url: url,
          });
        });
        res.on('error', (e) => finish({ ok: false, error: e instanceof Error ? e.message : 'error', elapsed_ms: Date.now() - started }));
      });
      req.on('error', (e) => finish({ ok: false, error: e instanceof Error ? e.message : 'error', elapsed_ms: Date.now() - started }));
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : 'invalid_url', elapsed_ms: Date.now() - started });
    }
  });
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

module.exports = { fetchPageText, extractTitle, extractMetaDescription };