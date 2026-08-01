const { validateEvent } = require('./validate');
const { requireAuth } = require('./auth');

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function createRouter(config, rawLedger) {
  return async function handle(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/health') {
      try {
        const health = await rawLedger.health();
        const diag = rawLedger.diagnostics();
        return send(res, 200, {
          ok: true,
          status: health.ok ? 'ok' : 'degraded',
          ledgerReachable: health.connected,
          outboxPending: diag.outboxPending,
          lastSuccessfulAppend: diag.lastSuccessfulAppend,
          lastRetryAttempt: diag.lastRetryAttempt,
          bridgeHealthy: diag.bridgeHealthy,
          appendLatencyMs: health.latencyMs,
          events: health.events
        });
      } catch (err) {
        return send(res, 503, { ok: false, status: 'degraded', error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/diagnostics') {
      if (!requireAuth(req, res, config.serviceKey)) return;
      const diag = rawLedger.diagnostics();
      const health = await rawLedger.health();
      return send(res, 200, {
        ok: true,
        connected: health.connected,
        ...diag
      });
    }

    if (method === 'GET' && pathname === '/events') {
      if (!requireAuth(req, res, config.serviceKey)) return;
      const options = {
        eventType: url.searchParams.get('eventType'),
        source: url.searchParams.get('source'),
        since: url.searchParams.get('since'),
        until: url.searchParams.get('until'),
        offset: url.searchParams.get('offset'),
        limit: url.searchParams.get('limit')
      };
      const result = await rawLedger.list(options);
      if (!result.ok) return send(res, 502, { ok: false, error: result.error });
      return send(res, 200, { ok: true, ...result });
    }

    if (method === 'GET' && pathname.startsWith('/events/')) {
      if (!requireAuth(req, res, config.serviceKey)) return;
      const id = pathname.slice(8);
      const result = await rawLedger.get(id);
      if (!result.ok) {
        const status = result.code === '404' ? 404 : 502;
        return send(res, status, { ok: false, error: result.error });
      }
      return send(res, 200, { ok: true, event: result.event });
    }

    if (method === 'POST' && pathname === '/events') {
      if (!requireAuth(req, res, config.serviceKey)) return;
      if (!body || typeof body !== 'object') {
        return send(res, 400, { ok: false, error: 'JSON body required' });
      }
      const valid = validateEvent(body);
      if (!valid.ok) return send(res, 400, { ok: false, error: valid.error });

      const result = await rawLedger.append(body);
      if (result.ok) {
        if (result.queued) {
          return send(res, 202, { ok: true, queued: true, fingerprint: result.fingerprint, error: result.error });
        }
        return send(res, 201, { ok: true, event: result.record });
      }

      const status = result.code === '409' ? 409 : 502;
      return send(res, status, { ok: false, error: result.error });
    }

    return send(res, 404, { ok: false, error: 'Not found' });
  };
}

module.exports = { createRouter };
