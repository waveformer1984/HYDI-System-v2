/**
 * Local operational health surface for the Heidi → Rezonate control plane.
 *
 * No Supabase or cloud calls. Reports the state of each layer independently:
 *   HEIDI_CONTROLLER, TASK_ROUTER, REZONATE_AGENT, REZONATE_CLIENT,
 *   LOCAL_PERSISTENCE, EVENT_BUS
 */

const path = require('path');
const fs = require('fs');
const { HeidiController } = require('../../pao-system/core/heidi.controller');
const { createClient } = require('./rezonate-client');

let _controller = null;

function getHeidiController() {
  if (!_controller) {
    _controller = new HeidiController();
  }
  return _controller;
}

async function getRezonateControlHealth(opts = {}) {
  const dataDir = opts.dataDir || process.env.REZONATE_DATA_DIR || path.join(__dirname, '..', '..', 'protoforge-applications', 'rezonate', 'data');
  const heidi = getHeidiController();
  const health = heidi.getHealth();

  const heidi_controller = health.heidi_controller;
  const task_router = health.task_router;
  const rezonate_agent = health.rezonate_agent;
  const rezonate_client = { available: false, reason: null };
  const local_persistence = { available: false, reason: null };
  const event_bus = health.event_bus;

  // Probe the canonical client by attempting a lightweight, non-mutating call.
  try {
    const client = await createClient({ dataDir, dbFile: 'heidi-health-check.json' });
    await client.listProjects();
    rezonate_client.available = true;
    rezonate_client.reason = 'lib/rezonate/rezonate-client.js imports and executes canonical repository methods';
  } catch (e) {
    rezonate_client.available = false;
    rezonate_client.reason = e instanceof Error ? e.message : 'Unknown client error';
  }

  // Probe local persistence: is the data directory writable and does a file exist or get created?
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const probeFile = path.join(dataDir, 'heidi-health-check.json');
    local_persistence.available = fs.existsSync(probeFile) || fs.existsSync(path.join(dataDir, 'heidi-db.json'));
    local_persistence.reason = `persistence probe at ${dataDir}`;
    if (fs.existsSync(probeFile)) {
      fs.rmSync(probeFile, { force: true });
    }
  } catch (e) {
    local_persistence.available = false;
    local_persistence.reason = e instanceof Error ? e.message : 'Unknown persistence error';
  }

  const diagnostic = {
    heidi_controller,
    task_router,
    rezonate_agent,
    rezonate_client,
    rezonate_canonical_api: rezonate_client,
    local_persistence,
    event_bus,
  };

  const allAvailable = Object.values(diagnostic).every((layer) => layer.available);
  return {
    ok: allAvailable,
    ...diagnostic,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getRezonateControlHealth };
