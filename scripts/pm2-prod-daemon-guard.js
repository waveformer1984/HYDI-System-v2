'use strict';

/**
 * Destructive-PM2-test guard. Several scripts under scripts/ restart,
 * stop or delete the REAL PM2-managed hydi-daemon as part of a test or a
 * convenience launcher. On Frank that daemon is production — running one
 * of these scripts against it costs the lock, the DB lease and the
 * running cognitive loop.
 *
 * Two refusals, both fail-closed:
 *   1. HYDI_ALLOW_PM2_DESTRUCTIVE_TESTS must be exactly 'true' — an armed
 *      opt-in, never implied.
 *   2. No PM2 process named 'hydi-daemon' may exist whose script is the
 *      production entry scripts/heidi-daemon-launcher.js. An unreadable
 *      `pm2 jlist` is a refusal too — unknown is not safe.
 */

const { execSync } = require('child_process');

const ENV_FLAG = 'HYDI_ALLOW_PM2_DESTRUCTIVE_TESTS';
const PROD_SCRIPT = 'heidi-daemon-launcher.js';

function productionDaemonPresent() {
  try {
    const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', timeout: 20000 }));
    const hit = (Array.isArray(list) ? list : []).find((p) => {
      const env = (p && p.pm2_env) || {};
      const script = String(env.pm_exec_path || env.script || '').replace(/\\/g, '/');
      return p && p.name === 'hydi-daemon' && script.endsWith(`scripts/${PROD_SCRIPT}`);
    });
    return hit ? { present: true, script: (hit.pm2_env && (hit.pm2_env.pm_exec_path || hit.pm2_env.script)) || PROD_SCRIPT } : { present: false };
  } catch (e) {
    return { present: null, error: e && e.message ? e.message : 'pm2 jlist unreadable' };
  }
}

/**
 * Call at the top of a script that mutates the PM2-managed daemon.
 * Exits 1 with a printed reason on any refusal. `label` names the caller
 * in the message (e.g. the script filename).
 */
function enforceDestructivePm2TestGuard(label = 'this script') {
  if (process.env[ENV_FLAG] !== 'true') {
    console.error(`Refusing: ${label} mutates the real PM2-managed hydi-daemon. Set ${ENV_FLAG}='true' to run it deliberately.`);
    process.exit(1);
  }
  const check = productionDaemonPresent();
  if (check.present !== false) {
    const why = check.present === true
      ? `a PM2 'hydi-daemon' already runs the production entry (${check.script}) — restarting it would kill the live daemon`
      : `cannot verify hydi-daemon is not production-managed (${check.error}) — refusing anyway`;
    console.error(`Refusing: ${why}.`);
    process.exit(1);
  }
}

module.exports = { enforceDestructivePm2TestGuard, productionDaemonPresent, ENV_FLAG, PROD_SCRIPT };
