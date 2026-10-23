/**
 * In-memory bridge store for local HYDI status snapshots.
 * Shared by api/dashboard-status-ingest.js and api/dashboard-status.js
 * within the same Vercel serverless bundle.
 */

let bridgeSnapshot = null;

export function setBridgeSnapshot(snapshot) {
  bridgeSnapshot = snapshot;
}

export function getBridgeSnapshot() {
  return bridgeSnapshot;
}
