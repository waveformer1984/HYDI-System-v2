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
  {
    // Read-only NFT status — answered from durable Rezonate state, never the
    // LLM. Mutations (mint/sell/buy via chat) stay refused below.
    taskType: 'REZONATE_NFT_STATUS',
    patterns: [
      /^(?:which|what)\s+nfts?\s+(?:have\s+i|do\s+i|are)\s+\w+/i,
      /^(?:what|which).*\bnfts?\b.*(?:minted|listed|sold|selling|owned|reconcil)/i,
      /\bnfts?\b.*\b(?:status|revenue|sales|market|listings?|transactions?|proceeds)\b/i,
      /\bnft\b.*\b(?:block|stuck|blocking|generat|earned|proceeds)/i,
      /\b(?:latest|last|recent)\s+nft\s+(?:transaction|sale|tx)/i,
      /\b(?:is|was)\s+.+\bnft\b.*\bon.?chain\b/i,
      /\bmy\s+nfts?\b/i,
    ],
    extract: (m) => {
      const q = m.input || m[0]; // classify on the full question, not the matched span
      return {
        kind: /reconcil/i.test(q) ? 'reconciled'
          : /block|stuck/i.test(q) ? 'blocker'
            : /latest|last|recent/i.test(q) ? 'latest'
              : /revenue|proceeds|earned|generat/i.test(q) ? 'revenue'
                : /minted/i.test(q) ? 'minted'
                  : /listed|for sale|market|listing/i.test(q) ? 'listed'
                    : /sold|sales|sell/i.test(q) ? 'sold'
                      : /on.?chain/i.test(q) ? 'verify' : 'status'
      };
    },
    validate: () => null,
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

  // Defensive: reject any request that looks like a destructive or disallowed
  // action. Word-boundary matching so "minted"/"sold" status questions pass.
  if (/\b(remove|drop|publish|mint|sell|buy|purchase)\b/i.test(lower)) {
    // …unless it's a status question — "what did my nft sell for" is a
    // read, not a mutation request.
    const nftStatus = INTENTS.find((i) => i.taskType === 'REZONATE_NFT_STATUS');
    const isQuestion = /^(what|which|is|was|did|how|show|list|do|are|who)\b/i.test(message.trim());
    const looksLikeStatus = nftStatus && nftStatus.patterns.some((p) => p.test(message));
    if (!(looksLikeStatus && isQuestion)) {
      const word = lower.match(/\b(remove|drop|publish|mint|sell|buy|purchase)\b/i)[1];
      return { ok: false, reason: `forbidden_intent: ${word} — mutating NFT/commerce actions go through the market UI/API, not chat` };
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
