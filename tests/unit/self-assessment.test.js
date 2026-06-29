'use strict';
const { assess, percentile } = require('../../evolution/self-assessment');

describe('self-assessment analyzer', () => {
  test('percentile handles empty / single / midpoint', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([10], 50)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });

  test('empty input is zeroed, NaN-free, and flagged idle', () => {
    const a = assess([], { windowHours: 6 });
    expect(a.total_events).toBe(0);
    expect(a.error_rate).toBe(0);
    expect(a.window_hours).toBe(6);
    expect(a.findings.some((f) => f.code === 'idle')).toBe(true);
  });

  test('tallies verdicts and flags a hot division (errors + latency)', () => {
    const events = [];
    for (let i = 0; i < 20; i++) events.push({ verdict: 'AUTO-APPROVE', division: 'galactic_bytes', elapsed_ms: 100 + i });
    for (let i = 0; i < 10; i++) events.push({ verdict: 'REVIEW', division: 'revenue', elapsed_ms: 200, error_message: i < 4 ? 'boom' : null });
    for (let i = 0; i < 5; i++) events.push({ verdict: 'BLOCK', division: 'revenue', elapsed_ms: 9000 });

    const a = assess(events);
    expect(a.total_events).toBe(35);
    expect(a.verdicts).toEqual({ 'AUTO-APPROVE': 20, REVIEW: 10, BLOCK: 5, other: 0 });
    expect(a.error_rate).toBeCloseTo(4 / 35, 3);
    expect(a.divisions.revenue.error_rate).toBeCloseTo(4 / 15, 3);
    expect(a.findings.some((f) => f.code === 'division_errors' && f.division === 'revenue')).toBe(true);
    expect(a.findings.some((f) => f.code === 'latency' && f.division === 'revenue')).toBe(true);
    expect(a.findings.some((f) => f.code === 'error_rate')).toBe(true);
    expect(a.latency_ms.p95).not.toBeNull();
  });

  test('clean traffic yields a single ok finding', () => {
    const a = assess([
      { verdict: 'AUTO-APPROVE', division: 'x', elapsed_ms: 50 },
      { verdict: 'AUTO-APPROVE', division: 'x', elapsed_ms: 60 },
    ]);
    expect(a.findings).toHaveLength(1);
    expect(a.findings[0].code).toBe('ok');
  });
});
