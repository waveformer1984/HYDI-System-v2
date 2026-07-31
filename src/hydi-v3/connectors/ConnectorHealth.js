'use strict';

function aggregate(connectors) {
  const items = connectors.map((connector) => connector.healthCheck());
  const failing = items.filter((h) => !h.ok);
  const ok = failing.length === 0;
  return {
    ok,
    total: items.length,
    healthy: items.length - failing.length,
    failing: failing.length,
    connectors: items,
  };
}

module.exports = { aggregate };
