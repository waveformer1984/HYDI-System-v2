'use strict';

/**
 * Read-only mock streams for Heidi Life integration tests and opt-in previews.
 * No PII — fixtures only.
 */

const STREAMS = Object.freeze({
  calendar: {
    enabled: false,
    items: [
      { id: 'mock-cal-1', title: 'Focus block', start: '2026-11-07T14:00:00Z', end: '2026-11-07T15:00:00Z' },
    ],
  },
  usage: {
    enabled: false,
    items: [{ id: 'mock-usage-1', app: 'Termux', minutes: 42 }],
  },
  stripe: {
    enabled: false,
    items: [{ id: 'mock-stripe-1', type: 'test_mode', amount_usd: 0, note: 'fixture' }],
  },
});

function listMockStreams(opts = {}) {
  const optIn = opts.optIn === true || process.env.HEIDI_LIFE_MOCK_STREAMS === 'true';
  if (!optIn) {
    return { optIn: false, streams: {}, suggestions: [] };
  }
  const streams = {};
  for (const [key, block] of Object.entries(STREAMS)) {
    streams[key] = { ...block, enabled: true };
  }
  const suggestions = [
    {
      id: 'suggest-focus',
      type: 'read_only',
      title: 'Try a 25m focus block',
      body: 'Mock suggestion — not actionable until Heidi Life gate approves.',
    },
  ];
  return { optIn: true, streams, suggestions };
}

module.exports = { listMockStreams, STREAMS };
