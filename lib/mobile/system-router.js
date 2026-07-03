'use strict'

/**
 * system-router.js — decides whether a mobile chat message should be
 * routed to a named HYDI subsystem (via the universal chat router,
 * api/chat/route.js) or handled as plain conversation.
 *
 * Users address a subsystem with an @-prefix: "@ursula status",
 * "@cascade process event: payment failed", "@hyve opportunity".
 * Callers may also pass an explicit `system` field which wins over
 * any prefix in the text.
 */

// Must stay in sync with systemHandlers in api/chat/route.js.
const KNOWN_SYSTEMS = [
  'ursula',
  'heidi',
  'cascade',
  'kilo',
  'protoforge',
  'hyve',
  'infrastructure',
  'rezonate',
]

const PREFIX_RE = new RegExp(`^@(${KNOWN_SYSTEMS.join('|')})\\b[:,]?\\s*`, 'i')

/**
 * @param {string} message          - Raw message text from the mobile UI.
 * @param {string} [explicitSystem] - Optional `system` field from the request body.
 * @returns {{ system: string|null, text: string }}
 *   system: subsystem to route to, or null for plain local conversation.
 *   text:   message with any @-prefix stripped ('status' when the prefix
 *           was sent alone, so "@ursula" behaves like "@ursula status").
 */
function parseSystemMessage(message, explicitSystem) {
  const raw = typeof message === 'string' ? message.trim() : ''

  if (explicitSystem) {
    const sys = String(explicitSystem).toLowerCase()
    if (KNOWN_SYSTEMS.includes(sys)) {
      return { system: sys, text: raw.replace(PREFIX_RE, '').trim() || 'status' }
    }
  }

  const match = raw.match(PREFIX_RE)
  if (match) {
    return {
      system: match[1].toLowerCase(),
      text: raw.slice(match[0].length).trim() || 'status',
    }
  }

  return { system: null, text: raw }
}

module.exports = { parseSystemMessage, KNOWN_SYSTEMS, PREFIX_RE }
