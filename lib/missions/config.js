'use strict';
/**
 * Configuration for protoforge.daily_opportunity_scan.
 *
 * Product priority per the operator's own stated order (Rezonate first).
 * Only Rezonate has real search terms wired up in v1 -- the shape below
 * is deliberately generic so Forge Finder / Switchboard / Proto.I.Y /
 * Build a Mind / Blame Games can each get their own PRODUCTS entry later
 * without touching the scout, analyzer, or store code.
 */

const PRODUCTS = {
  rezonate: {
    label: 'Rezonate',
    // Real terms tied to Rezonate's actual, verified capabilities (see
    // docs/REZONATE_CANONICAL_STATE.md): AI song generation, stem
    // separation, sample catalog, DAW export, algorithmic sequencing.
    // Terms describe the market Rezonate competes/partners in, not
    // invented buzzwords.
    searchTerms: [
      'AI music generation',
      'stem separation tool',
      'royalty free sample pack',
      'sync licensing music',
      'music production plugin',
      'AI song generator',
    ],
    // Words that, if present, raise relevance -- used by the analyzer's
    // deterministic scoring, not by the scouts themselves.
    relevanceKeywords: [
      'ai music', 'music generation', 'song generation', 'stem separation',
      'demucs', 'sample pack', 'sync licensing', 'music licensing',
      'daw', 'music production', 'audio ai', 'suno', 'udio', 'music tech',
      'royalty free', 'beat maker', 'music plugin',
    ],
  },
};

const SOURCES = {
  hn_algolia: {
    label: 'Hacker News (Algolia search API)',
    enabled: true,
  },
  reddit_public: {
    label: 'Reddit (public JSON search, unauthenticated)',
    // Disabled by default: verified 2026-09-10 that Reddit returns HTTP 403
    // to every request from this machine's network egress regardless of
    // User-Agent (tested with both the descriptive UA above and a generic
    // browser UA) -- an IP-level block, not a request-shape problem. The
    // scout code is real and tested (tests/unit/protoforge-reddit-scout.test.js);
    // it simply has nothing to talk to from here right now. Re-enable by
    // setting this to true (or PROTOFORGE_SCOUT_REDDIT_ENABLED=true) once
    // running from a network Reddit doesn't block.
    enabled: process.env.PROTOFORGE_SCOUT_REDDIT_ENABLED === 'true',
    subreddits: ['WeAreTheMusicMakers', 'musicproduction', 'edmproduction'],
  },
};

// Never claim to be a browser scraping something it isn't -- identify
// honestly so operators of the public APIs we call can see who we are.
const USER_AGENT = 'HYDI-ProtoForge-OpportunityScout/1.0 (+local research mission; read-only; contact: operator)';

const HTTP_TIMEOUT_MS = 10000;

// A record must clear this confidence to be marked 'high_confidence'
// rather than 'needs_review'. Below REJECT_BELOW it is filed as
// 'rejected' (still persisted, still visible -- rejection is a
// classification here, not a deletion).
const HIGH_CONFIDENCE_THRESHOLD = 70;
const REJECT_BELOW = 25;

module.exports = {
  PRODUCTS,
  SOURCES,
  USER_AGENT,
  HTTP_TIMEOUT_MS,
  HIGH_CONFIDENCE_THRESHOLD,
  REJECT_BELOW,
  MISSION_ID: 'protoforge.daily_opportunity_scan',
};
