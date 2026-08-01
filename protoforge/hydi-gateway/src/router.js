const { validateEvent } = require('./validate');
const { requireAuth } = require('./auth');

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function createRouter(config, store) {
  return function handle(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    if (method === 'GET' && pathname === '/health') {
      return send(res, 200, { ok: true, status: 'ok', events: store.count() });
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
      return send(res, 200, { ok: true, ...store.list(options) });
    }

    if (method === 'GET' && pathname.startsWith('/events/')) {
      if (!requireAuth(req, res, config.serviceKey)) return;
      const id = pathname.slice(8);
      const record = store.get(id);
      if (!record) return send(res, 404, { ok: false, error: 'Event not found' });
      return send(res, 200, { ok: true, event: record });
    }

    if (method === 'POST' && pathname === '/events') {
      if (!requireAuth(req, res, config.serviceKey)) return;
      if (!body || typeof body !== 'object') {
        return send(res, 400, { ok: false, error: 'JSON body required' });
      }
      const valid = validateEvent(body);
      if (!valid.ok) return send(res, 400, { ok: false, error: valid.error });
      const record = store.append(body);
      return send(res, 201, { ok: true, event: record });
    }

    return send(res, 404, { ok: false, error: 'Not found' });
  };
}

module.exports = { createRouter };
