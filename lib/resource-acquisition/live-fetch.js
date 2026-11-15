'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchPageText } = require('./verify/fetch-page');

const DEFAULT_TIMEOUT_MS = Number(process.env.HYDI_RESOURCE_FETCH_TIMEOUT_MS || 8000);
const MAX_URLS = Number(process.env.HYDI_LIVE_DISCOVERY_MAX_URLS || 12);
const LIVE_MAX_BYTES = 256000;
const CACHE_DIR = path.join(
  process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..'),
  '.runtime',
  'resource-discovery',
  'http-cache',
);

async function fetchUrlMeta(url, probeOpts = {}) {
  const started = Date.now();
  const page = await fetchPageText(url, DEFAULT_TIMEOUT_MS, LIVE_MAX_BYTES, { allowHttp: false, ...probeOpts });
  if (!page.ok) {
    return {
      ok: false,
      url,
      error: page.error || 'fetch_error',
      elapsed_ms: page.elapsed_ms ?? Date.now() - started,
    };
  }
  const contentLength = page.byte_length ?? (page.body ? Buffer.byteLength(page.body, 'utf8') : 0);
  return {
    ok: true,
    url,
    status: page.status,
    elapsed_ms: page.elapsed_ms ?? Date.now() - started,
    content_length_seen: contentLength,
    truncated: Boolean(page.truncated),
    classification: 'HTTP_REACHABILITY_ONLY',
    benefits_verified: false,
  };
}

async function runLiveReachabilityCheck(urls) {
  const limited = urls.slice(0, MAX_URLS);
  const results = [];
  for (const url of limited) {
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