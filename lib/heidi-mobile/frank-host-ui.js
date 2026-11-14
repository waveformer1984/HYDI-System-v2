'use strict';

/**
 * Pure Frank host card presentation rules for Heidi Mobile Status.
 * Keeps “older BFF” (missing frank_host) and stale/degraded honesty testable without RTL.
 */

function isFrankHostCardVisible(frankHost) {
  return Boolean(frankHost);
}

function frankHostVitalsLabel(frankHost) {
  if (frankHost.stale) return 'stale';
  return frankHost.state;
}

function frankHostVitalsDotTone(frankHost) {
  if (frankHost.stale) return 'warn';
  if (frankHost.state === 'healthy') return 'ok';
  if (frankHost.state === 'degraded') return 'bad';
  return 'warn';
}

module.exports = {
  isFrankHostCardVisible,
  frankHostVitalsLabel,
  frankHostVitalsDotTone,
};