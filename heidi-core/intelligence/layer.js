'use strict';

/**
 * heidi-core adapter for lib/heidi-intelligence (optional via HEIDI_INTELLIGENCE_LAYER=true).
 */

const intelligence = require('../../lib/heidi-intelligence');

function isEnabled() {
  return intelligence.layerEnabled();
}

function enrichBeginTurn(args) {
  if (!isEnabled()) return null;
  return intelligence.prepareTurn(args);
}

function enrichEndTurn(args) {
  if (!isEnabled() || !args.intelligence) return null;
  return intelligence.finalizeTurn(args);
}

module.exports = { isEnabled, enrichBeginTurn, enrichEndTurn, intelligence };