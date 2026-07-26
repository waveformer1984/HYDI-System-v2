'use strict';

const path = require('path');
const OperatorSession = require('./OperatorSession');

/**
 * Process-wide OperatorSession for the local dashboard routes.
 *
 * Next.js recreates route modules on hot reload, so the session is cached on
 * globalThis rather than in module scope. Every /api/cockpit route shares one
 * session, which means the browser and the readline CLI observe the same
 * StrategicObjectives instance, the same owner priority, and the same
 * persistence directory.
 */
const CACHE_KEY = Symbol.for('protoforge.cockpit.session');

function dataPath() {
  return process.env.HYDI_DATA_PATH
    ? path.resolve(process.env.HYDI_DATA_PATH)
    : path.resolve(__dirname, '../../data');
}

async function getCockpitSession() {
  const cache = globalThis[CACHE_KEY];
  if (cache && cache.session) return cache.session;
  if (cache && cache.promise) return cache.promise;

  const session = new OperatorSession({
    dataPath: dataPath(),
    ownerPriority: process.env.HYDI_OWNER_PRIORITY || 'default',
  });

  const promise = session.start().then((started) => {
    globalThis[CACHE_KEY] = { session: started };
    return started;
  }).catch((error) => {
    globalThis[CACHE_KEY] = null;
    throw error;
  });

  globalThis[CACHE_KEY] = { promise };
  return promise;
}

async function resetCockpitSession() {
  const cache = globalThis[CACHE_KEY];
  globalThis[CACHE_KEY] = null;
  if (cache && cache.session) await cache.session.destroy();
}

module.exports = { getCockpitSession, resetCockpitSession, CACHE_KEY };
