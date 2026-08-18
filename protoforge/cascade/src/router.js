function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function createRouter(config, deps) {
  const { store, lineage, metrics, replay } = deps;

  return async function handle(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/health') {
      return send(res, 200, {
        ok: true,
        status: 'ok',
        version: config.processorVersion,
        events: store.count(),
        replayProgress: metrics.replayProgress
      });
    }

    if (method === 'GET' && pathname === '/diagnostics') {
      return send(res, 200, {
        ok: true,
        metrics: metrics.snapshot(),
        events: store.count()
      });
    }

    if (method === 'POST' && pathname === '/replay') {
      const result = await replay.replay(body || {});
      if (!result.ok) return send(res, 502, { ok: false, error: result.error });
      return send(res, 200, { ok: true, ...result });
    }

    if (method === 'GET' && pathname === '/events') {
      const options = {
        eventType: url.searchParams.get('eventType'),
        source: url.searchParams.get('source'),
        offset: url.searchParams.get('offset'),
        limit: url.searchParams.get('limit')
      };
      const result = store.list(options);
      return send(res, 200, { ok: true, ...result });
    }

    if (method === 'GET' && pathname.startsWith('/events/')) {
      const id = pathname.slice(8);
      const result = store.get(id);
      if (!result.ok) return send(res, 404, { ok: false, error: result.error });
      return send(res, 200, { ok: true, event: result.event });
    }

    if (method === 'GET' && pathname.startsWith('/lineage/')) {
      const fingerprint = pathname.slice(9);
      const result = lineage.getLineage(fingerprint);
      if (!result.ok) return send(res, 404, { ok: false, error: result.error });
      return send(res, 200, { ok: true, ...result });
    }

    if (method === 'GET' && pathname === '/metrics') {
      return send(res, 200, { ok: true, metrics: metrics.snapshot() });
    }

    return send(res, 404, { ok: false, error: 'Not found' });
  };
}

module.exports = { createRouter };
