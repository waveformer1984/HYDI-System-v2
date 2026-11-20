'use strict';

/**
 * Client-side offline queue (pure functions — tested without browser).
 * Items sync via POST /api/makeready-crew/sync; failed items stay queued.
 */

function enqueue(queue, item) {
  const next = Array.isArray(queue) ? [...queue] : [];
  if (!item?.clientId) {
    throw new Error('clientId required');
  }
  if (next.some((q) => q.clientId === item.clientId)) {
    return next;
  }
  next.push({
    clientId: item.clientId,
    requestId: item.requestId,
    action: item.action,
    payload: item.payload || {},
    createdAt: item.createdAt || new Date().toISOString(),
  });
  return next;
}

function applySyncResults(queue, results) {
  const failed = new Set(
    (Array.isArray(results) ? results : [])
      .filter((r) => !r.ok)
      .map((r) => r.clientId),
  );
  const okIds = new Set(
    (Array.isArray(results) ? results : [])
      .filter((r) => r.ok)
      .map((r) => r.clientId),
  );
  return (Array.isArray(queue) ? queue : []).filter((q) => !okIds.has(q.clientId) || failed.has(q.clientId));
}

function onlineStatus(navigatorOnline) {
  if (navigatorOnline === false) return 'offline';
  return 'online';
}

module.exports = { enqueue, applySyncResults, onlineStatus };