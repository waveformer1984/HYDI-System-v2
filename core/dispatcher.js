// core/dispatcher.js
//
// Given a routing decision { worker, action, ... } and the event, actually
// hand the work off. Supports two transports per worker:
//   1. In-process function:  worker.execute(event) → result
//   2. HTTP endpoint:        worker.endpoint = 'http://host:port/path'
//                            POSTs {event, route} as JSON
//
// Updates the circuit breaker based on outcome. Times out after a configurable
// wall-clock deadline (mirrors the HYDI-Ursula M2 8s Promise.race pattern).
//
// Usage:
//   const out = await dispatch({ event, decision, breaker, timeoutMs: 8000 });
//   out.ok       — true on success
//   out.result   — worker return value (or HTTP response body)
//   out.error    — error message if failed
//   out.transport— 'execute' | 'endpoint' | 'none'
//   out.elapsedMs

const http = require('http');
const https = require('https');
const { URL } = require('url');

function postJson(urlStr, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { return reject(new Error(`bad url: ${urlStr}`)); }
    const lib = url.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'content-type': 'application/json',
        'content-length': data.length
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function dispatch({ event, decision, breaker, timeoutMs = 8000 }) {
  const t0 = Date.now();
  const worker = decision.worker;

  // No worker → dead-letter is the caller's responsibility, we just report.
  if (!worker) {
    return {
      ok: false,
      transport: 'none',
      error: 'no worker selected',
      result: null,
      elapsedMs: 0
    };
  }

  const timeoutPromise = (label) => new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs).unref()
  );

  try {
    let result;
    let transport;

    if (typeof worker.execute === 'function') {
      transport = 'execute';
      result = await Promise.race([
        Promise.resolve().then(() => worker.execute(event, decision)),
        timeoutPromise('execute')
      ]);
    } else if (worker.endpoint) {
      transport = 'endpoint';
      result = await postJson(worker.endpoint, { event, route: decision }, timeoutMs);
    } else if (worker.metadata && worker.metadata.endpoint) {
      transport = 'endpoint';
      result = await postJson(worker.metadata.endpoint, { event, route: decision }, timeoutMs);
    } else {
      throw new Error(`worker ${worker.id} has no execute() or endpoint`);
    }

    if (breaker) breaker.recordSuccess(worker.id);
    return {
      ok: true,
      transport,
      result,
      error: null,
      elapsedMs: Date.now() - t0
    };
  } catch (err) {
    if (breaker) breaker.recordFailure(worker.id);
    return {
      ok: false,
      transport: typeof worker.execute === 'function' ? 'execute' : (worker.endpoint || worker.metadata?.endpoint ? 'endpoint' : 'none'),
      result: null,
      error: err.message,
      elapsedMs: Date.now() - t0
    };
  }
}

module.exports = { dispatch, postJson };
