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
 * Invalid, ambiguous, malformed, or unsupported requests return { ok: false, reason }.
 * The normalizer does not execute anything, does not call the repository, and does
 * not make cloud or Supabase calls.
 */

const { classifyUserMessage } = require('./capability-guard');

const INTENTS = [
  {
    taskType: 'REZONATE_CREATE_PROJECT',
    patterns: [
      /^create(?:\s+a)?\s+project(?:\s+called\s+['"]?(.+?)['"]?)?$/i,
      /^make(?:\s+a)?\s+project(?:\s+called\s+['"]?(.+?)['"]?)?$/i,
    ],
    extract: (m) => ({ name: (m[1] || '').trim() }),
    validate: (params) => (typeof params.name === 'string' && params.name.length > 0) ? null : 'REZONATE_CREATE_PROJECT requires a non-empty { name: string }',
  },
  {
    taskType: 'REZONATE_LIST_PROJECTS',
    patterns: [
      /^list\s+(?:all\s+)?projects$/i,
      /^show\s+(?:all\s+)?projects$/i,
      /^how\s+many\s+projects$/i,
    ],
    extract: () => ({}),
    validate: () => null,
  },
  {
    taskType: 'REZONATE_GET_PROJECT',
    patterns: [
      /^get\s+project\s+['"]?(.+?)['"]?$/i,
      /^project\s+['"]?(.+?)['"]?$/i,
      /^show\s+project\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ id: (m[1] || '').trim() }),
    validate: (params) => (typeof params.id === 'string' && params.id.length > 0) ? null : 'REZONATE_GET_PROJECT requires a non-empty { id: string }',
  },
  {
    taskType: 'REZONATE_CREATE_TRACK',
    patterns: [
      /^create(?:\s+a)?\s+track(?:\s+called\s+['"]?(.+?)['"]?)?\s+in\s+project\s+['"]?(.+?)['"]?$/i,
      /^add\s+a\s+track(?:\s+called\s+['"]?(.+?)['"]?)?\s+to\s+project\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ name: (m[1] || '').trim(), projectId: (m[2] || '').trim() }),
    validate: (params) => (typeof params.name === 'string' && params.name.length > 0 && typeof params.projectId === 'string' && params.projectId.length > 0)
      ? null
      : 'REZONATE_CREATE_TRACK requires non-empty { name: string, projectId: string }',
  },
  {
    taskType: 'REZONATE_LIST_TRACKS',
    patterns: [
      /^list\s+tracks\s+(?:in|for)\s+project\s+['"]?(.+?)['"]?$/i,
      /^show\s+tracks\s+(?:in|for)\s+project\s+['"]?(.+?)['"]?$/i,
    ],
    extract: (m) => ({ projectId: (m[1] || '').trim() }),
    validate: (params) => (typeof params.projectId === 'string' && params.projectId.length > 0) ? null : 'REZONATE_LIST_TRACKS requires a non-empty { projectId: string }',
  },
];

function normalizeRezonateIntent(message) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { ok: false, reason: 'empty_message' };
  }

  const lower = message.toLowerCase();

  // Capability-aware classification: detect unsupported / planned / forbidden
  // requests before any pattern matching, so we never hallucinate an implementation.
  const classified = classifyUserMessage(message);
  if (classified) {
    return classified;
  }

  // Explicit malformed checks for known keyword patterns that would otherwise fall
  // through as unrecognized. This gives the user a truthful reason, not silence.
  if (/^create(?:\s+a)?\s+project\s+called\s*$/i.test(message) || /^make(?:\s+a)?\s+project\s+called\s*$/i.test(message)) {
    return { ok: false, reason: 'malformed: REZONATE_CREATE_PROJECT requires a non-empty { name: string }' };
  }
  if (/^create(?:\s+a)?\s+track\s+called\s*$/i.test(message)) {
    return { ok: false, reason: 'malformed: REZONATE_CREATE_TRACK requires a non-empty { name: string }' };
  }

  // Defensive: reject any request that looks like a destructive or disallowed action.
  const forbidden = ['remove', 'drop', 'publish', 'mint', 'sell'];
  for (const word of forbidden) {
    if (lower.includes(word)) {
      return { ok: false, reason: `forbidden_intent: ${word}` };
    }
  }

  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      const match = message.match(pattern);
      if (match) {
        const parameters = intent.extract(match);
        const validationError = intent.validate(parameters);
        if (validationError) {
          return { ok: false, reason: `malformed: ${validationError}` };
        }
        return {
          ok: true,
          taskType: intent.taskType,
          parameters,
        };
      }
    }
  }

  return { ok: false, reason: 'unrecognized_intent' };
}

module.exports = { normalizeRezonateIntent, INTENTS };
