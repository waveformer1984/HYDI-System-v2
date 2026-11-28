'use strict';

// Heidi Mobile — read-only persistent-agent snapshot + recent audit events.
// Does not call heidi-core/heidi-agent.js; reads Supabase via lib/store.

const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { fetchOperationalMobileState } = require('../../../lib/heidi-mobile/operational-state-read.js');

module.exports = async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'state', rateMax: 30 });
  if (!g.ok) return;

  const started = Date.now();
  const body = await fetchOperationalMobileState();

  if (!body.ok) {
    const status =
      body.reason === 'store_unavailable' || body.reason === 'stale_heartbeat' || body.reason === 'no_heartbeat'
        ? 503
        : 502;
    return res.status(status).json({
      ...body,
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
      device_id: g.session.deviceId,
    });
  }

  return res.status(200).json({
    ...body,
    latency_ms: Date.now() - started,
    device_id: g.session.deviceId,
  });
};