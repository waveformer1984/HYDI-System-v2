// scripts/observatory/pm2_sanitizer.js
// Reads `pm2 jlist` JSON on stdin and emits a reduced, safe JSON array on stdout.
//
// Why this exists: pm2_env embeds the process environment, which on Windows can
// contain duplicate keys differing only by case (username vs USERNAME). Windows
// PowerShell ConvertFrom-Json is case-insensitive and throws on those duplicates.
// This reducer also keeps process environment VALUES out of telemetry entirely —
// pm2 env may carry credentials, and observatory output must never store secrets.
'use strict';
const fs = require('fs');

/** The reduced, env-free record for each PM2 process. */
function sanitizePm2List(arr) {
  return (Array.isArray(arr) ? arr : []).map((proc) => {
    const env = (proc && proc.pm2_env) || {};
    const mon = (proc && proc.monit) || {};
    return {
      name: proc.name ?? null,
      pid: proc.pid ?? null,
      status: env.status ?? null,
      restarts: env.restart_time ?? null,
      uptime_ms: env.pm_uptime ?? null,
      mem_bytes: mon.memory ?? null,
      cpu_pct: mon.cpu ?? null,
    };
  });
}

if (require.main === module) {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    process.stdout.write(JSON.stringify(sanitizePm2List(JSON.parse(raw || '[]'))));
  } catch (e) {
    console.error('pm2_sanitizer error:', e && e.message ? e.message : e);
    process.exit(2);
  }
}

module.exports = { sanitizePm2List };
