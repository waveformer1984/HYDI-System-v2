/**
 * termuxClient.js — calls the local TermuxBridge HTTP service
 * The bridge runs on the Termux/Android device (port 5151 by default).
 * Access via tunnel URL set in TERMUX_BRIDGE_URL env var.
 *
 * Expected env:
 *   TERMUX_BRIDGE_URL=https://your-cloudflare-tunnel.trycloudflare.com
 *   TERMUX_BRIDGE_SECRET=optional-shared-secret  (future: HMAC auth)
 */

const BRIDGE_URL = process.env.TERMUX_BRIDGE_URL?.replace(/\/$/, '') ?? ''

if (!BRIDGE_URL) {
  console.warn('[termuxClient] TERMUX_BRIDGE_URL not set — edge node calls will fail')
}

async function _post(path, body) {
  if (!BRIDGE_URL) throw new Error('TERMUX_BRIDGE_URL not configured')
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`TermuxBridge ${res.status} on ${path}`)
  return res.json()
}

async function _get(path) {
  if (!BRIDGE_URL) throw new Error('TERMUX_BRIDGE_URL not configured')
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`TermuxBridge ${res.status} on ${path}`)
  return res.json()
}

/** Returns battery, storage and uptime from the Android device. */
export async function getSystemStatus() {
  return _get('/status')
}

/** Push a notification to the Android shade. */
export async function triggerNotification(title, message) {
  return _post('/notify', { title, message })
}

/** Run a pre-approved command on the edge node. */
export async function executeLocalCommand(cmd) {
  return _post('/exec', { cmd })
}

/** Liveness check — resolves true if bridge is reachable. */
export async function isReachable() {
  try {
    await _get('/health')
    return true
  } catch {
    return false
  }
}
