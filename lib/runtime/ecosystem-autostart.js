'use strict';

/**
 * PM2 ecosystem apps with `autostart: false` stay declared (drift audit, docs)
 * but are omitted from fleet bring-up (`scripts/pm2-start-declared.js`).
 */
const path = require('path');

function loadApps(root) {
  const eco = require(path.join(root, 'ecosystem.config.js'));
  return Array.isArray(eco.apps) ? eco.apps : [];
}

/** @param {string} [root] repo root */
function autostartApps(root = path.join(__dirname, '..', '..')) {
  return loadApps(root).filter((app) => app && app.name && app.autostart !== false);
}

/** @param {string} [root] */
function autostartAppNames(root) {
  return autostartApps(root).map((app) => app.name);
}

/**
 * argv for `pm2 start ecosystem.config.js --only a,b,c` (autostart apps only).
 * @param {string} [root]
 */
function pm2StartOnlyArgs(root = path.join(__dirname, '..', '..')) {
  const ecosystemPath = path.join(root, 'ecosystem.config.js');
  const names = autostartAppNames(root);
  if (!names.length) {
    return ['start', ecosystemPath];
  }
  return ['start', ecosystemPath, '--only', names.join(',')];
}

module.exports = {
  autostartApps,
  autostartAppNames,
  pm2StartOnlyArgs,
};