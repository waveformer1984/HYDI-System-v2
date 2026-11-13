'use strict';

const { listMockStreams } = require('../../lib/heidi-life/mock-streams');

describe('heidi-life mock streams', () => {
  const prev = process.env.HEIDI_LIFE_MOCK_STREAMS;

  afterEach(() => {
    if (prev === undefined) delete process.env.HEIDI_LIFE_MOCK_STREAMS;
    else process.env.HEIDI_LIFE_MOCK_STREAMS = prev;
  });

  it('is off by default', () => {
    delete process.env.HEIDI_LIFE_MOCK_STREAMS;
    const r = listMockStreams();
    expect(r.optIn).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it('returns fixtures when opt-in', () => {
    process.env.HEIDI_LIFE_MOCK_STREAMS = 'true';
    const r = listMockStreams();
    expect(r.optIn).toBe(true);
    expect(r.streams.calendar.enabled).toBe(true);
    expect(r.suggestions[0].type).toBe('read_only');
  });
});
