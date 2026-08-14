/**
 * Rezonate intent normalizer for the Heidi chat surface.
 *
 * Converts free-form user text into an explicit, testable task structure.
 *
 *   {
 *     ok: true,
 *     taskType: 'REZONATE_CREATE_PROJECT',
 *     parameters: { name: 'Demo' }
 *   }
 *
 * Invalid or ambiguous requests return { ok: false, reason }.
 * No cloud calls, no AI parser, no second persistence path.
 */

const INTENTS = [
  {
    taskType: 'REZONATE_CREATE_PROJECT',
    patterns: [
      /^create(?:\s+a)?\s+project(?:\s+called)?\s+['"]?(.+?)['"]?$/i,
      /^make(?:\s+a)?\s+project(?:\s+called)?\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ name: m[1].trim() }),
  },
  {
    taskType: 'REZONATE_LIST_PROJECTS',
    patterns: [
      /^list\s+(?:all\s+)?projects$/i,
      /^show\s+(?:all\s+)?projects$/i,
      /^how\s+many\s+projects$/i,
    ],
    extract: () => ({}),
  },
  {
    taskType: 'REZONATE_GET_PROJECT',
    patterns: [
      /^get\s+project\s+['"]?(.+?)['"]?$/i,
      /^project\s+['"]?(.+?)['"]?$/i,
      /^show\s+project\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ id: m[1].trim() }),
  },
  {
    taskType: 'REZONATE_CREATE_TRACK',
    patterns: [
      /^create(?:\s+a)?\s+track(?:\s+called)?\s+['"]?(.+?)['"]?\s+in\s+project\s+['"]?(.+?)['"]?$/i,
      /^add\s+a\s+track(?:\s+called)?\s+['"]?(.+?)['"]?\s+to\s+project\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ name: m[1].trim(), projectId: m[2].trim() }),
  },
  {
    taskType: 'REZONATE_LIST_TRACKS',
    patterns: [
      /^list\s+tracks\s+(?:in|for)\s+project\s+['"]?(.+?)['"]?$/i,
      /^show\s+tracks\s+(?:in|for)\s+project\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ projectId: m[1].trim() }),
  },
];

function normalizeRezonateIntent(message) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { ok: false, reason: 'empty_message' };
  }

  const lower = message.toLowerCase();

  // Defensive: reject any request that looks like a delete, publish, NFT, or blockchain.
  const forbidden = ['delete', 'remove', 'drop', 'publish', 'mint', 'nft', 'marketplace', 'blockchain', 'sell'];
  for (const word of forbidden) {
    if (lower.includes(word)) {
      return { ok: false, reason: `forbidden_intent: ${word}` };
    }
  }

  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      const match = message.match(pattern);
      if (match) {
        return {
          ok: true,
          taskType: intent.taskType,
          parameters: intent.extract(match),
        };
      }
    }
  }

  return { ok: false, reason: 'unrecognized_intent' };
}

module.exports = { normalizeRezonateIntent, INTENTS };
