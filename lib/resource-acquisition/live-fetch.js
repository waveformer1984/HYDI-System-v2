'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = Number(process.env.HYDI_RESOURCE_FETCH_TIMEOUT_MS || 8000);
const MAX_URLS = Number(process.env.HYDI_LIVE_DISCOVERY_MAX_URLS || 12);
const CACHE_DIR = path.join(
  process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..'),
  '.runtime',
  'resource-discovery',
  'http-cache',
);

function fetchUrlMeta(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    try {
      const req = https.get(
        url,
        { timeout: DEFAULT_TIMEOUT_MS, headers: { 'User-Agent': 'HYDI-ResourceDiscovery/1.0 (operator-audit)' } },
        (res) => {
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > 256000) res.destroy();
          });
          res.on('end', () => {
            resolve({
              ok: true,
              url,
              status: res.statusCode,
              elapsed_ms: Date.now() - started,
              content_length_seen: size,
              classification: 'HTTP_REACHABILITY_ONLY',
              benefits_verified: false,
            });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, url, error: 'timeout', elapsed_ms: Date.now() - started });
      });
      req.on('error', (e) => resolve({ ok: false, url, error: e instanceof Error ? e.message : 'fetch_error' }));
    } catch (e) {
      resolve({ ok: false, url, error: e instanceof Error ? e.message : 'invalid_url' });
    }
  });
}

async function runLiveReachabilityCheck(urls) {
  const limited = urls.slice(0, MAX_URLS);
  const results = [];
  for (const url of limited) {
    // sequential — respect rate / burst discipline
    // eslint-disable-next-line no-await-in-loop
    const r = await fetchUrlMeta(url);
    results.push(r);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const id = crypto.randomBytes(8).toString('hex');
  const outPath = path.join(CACHE_DIR, `${id}.json`);
  const payload = { at: new Date().toISOString(), results, note: 'Reachability only — not eligibility or benefit verification.' };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return { ok: true, cache_file: outPath, checked: results.length, results };
}

module.exports = { fetchUrlMeta, runLiveReachabilityCheck, CACHE_DIR };