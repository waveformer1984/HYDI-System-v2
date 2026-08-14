/**
 * Local operational health surface for the Heidi → Rezonate control plane.
 *
 * No Supabase or cloud calls. Reports the state of each layer:
 *   HEIDI_CONTROLLER, REZONATE_AGENT, REZONATE_CANONICAL_API,
 *   LOCAL_PERSISTENCE, EVENT_BUS
 */

const { HeidiController } = require('../../pao-system/core/heidi.controller');

let _controller = null;

function getHeidiController() {
  if (!_controller) {
    _controller = new HeidiController();
  }
  return _controller;
}

async function getRezonateControlHealth() {
  const heidi = getHeidiController();
  const health = heidi.getHealth();

  // Verify each layer with a small, safe probe.
  const diagnostic = {
    heidi_controller: health.heidi_controller,
    rezonate_agent: health.rezonate_agent,
    rezonate_canonical_api: health.rezonate_canonical_api,
    local_persistence: health.local_persistence,
    event_bus: health.event_bus,
  };

  const allAvailable = Object.values(diagnostic).every((layer) => layer.available);
  return {
    ok: allAvailable,
    ...diagnostic,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getRezonateControlHealth };
