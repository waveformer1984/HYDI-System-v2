'use strict';

const { mergeJobLines, nextPollDelay, isTerminal } = require('../../lib/heidi-mobile/client/jobs');

const line = (seq) => ({ seq, ts: seq, stream: 'stdout', text: `l${seq}` });

describe('heidi-mobile job log helpers', () => {
  it('appends only newer lines, so a retried poll never duplicates output', () => {
    const a = mergeJobLines([], [line(1), line(2)]);
    const b = mergeJobLines(a, [line(2), line(3)]);
    expect(b.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(mergeJobLines(b, [])).toBe(b);
  });

  it('keeps only the newest lines on the phone', () => {
    const many = Array.from({ length: 50 }, (_, i) => line(i + 1));
    expect(mergeJobLines([], many, 10).map((l) => l.seq)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
  });

  it('backs off on failures (1s, 2s, 4s … 15s cap) and polls fast while running', () => {
    expect(nextPollDelay(0, true)).toBe(1000);
    expect([1, 2, 3, 4, 5, 9].map((f) => nextPollDelay(f, true))).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    expect(nextPollDelay(0, false)).toBe(0);
  });

  it('knows the terminal states', () => {
    expect(['succeeded', 'failed', 'cancelled', 'timed_out'].every(isTerminal)).toBe(true);
    expect(isTerminal('running')).toBe(false);
  });
});
