/**
 * Unit tests for workers/time-period.js.
 *
 * `time_period` is part of the worker event vocabulary, but every consumer
 * resolved it independently: `NotificationWorker` and `BehaviorPatternWorker`
 * each had their own copy of the same if/else chain (already drifted —
 * `yesterday` was understood by only one), and `CostMarginWorker` ignored the
 * field entirely, always querying a hardcoded 30 days while labelling the
 * stored `cost_analytics` row with whatever period was requested.
 *
 * Times are asserted against a frozen clock so the windows are exact rather
 * than approximately-now.
 */

'use strict';

const {
  SUPPORTED_PERIODS,
  HOURS_PER_DAY,
  resolvePeriodStart,
  isSupportedPeriod,
} = require('../../workers/time-period');

// A Thursday, mid-afternoon, so day-boundary rounding is visible.
const NOW = new Date('2026-08-05T14:30:00.000Z');

describe('time-period', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('resolvePeriodStart', () => {
    it('resolves "today" to the start of the current day', () => {
      const start = resolvePeriodStart('today', { fallbackHours: 24 });

      expect(start.getFullYear()).toBe(new Date(NOW).getFullYear());
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
    });

    it('resolves "yesterday" to the start of the previous day', () => {
      const today = resolvePeriodStart('today', { fallbackHours: 24 });
      const yesterday = resolvePeriodStart('yesterday', { fallbackHours: 24 });

      expect(today.getTime() - yesterday.getTime()).toBe(HOURS_PER_DAY * 60 * 60 * 1000);
      expect(yesterday.getHours()).toBe(0);
    });

    it('resolves "week" to seven days back', () => {
      const start = resolvePeriodStart('week', { fallbackHours: 24 });

      expect(NOW.getTime() - start.getTime()).toBe(7 * HOURS_PER_DAY * 60 * 60 * 1000);
    });

    it('resolves "month" to one calendar month back', () => {
      const start = resolvePeriodStart('month', { fallbackHours: 24 });

      // Calendar month, not a fixed 30 days: July 5th from August 5th.
      expect(start.getMonth()).toBe(new Date(NOW).getMonth() - 1);
      expect(start.getDate()).toBe(new Date(NOW).getDate());
    });

    describe('fallback', () => {
      it.each([
        ['an unrecognised period', 'last-fortnight'],
        ['undefined', undefined],
        ['null', null],
        ['an empty string', ''],
      ])('uses fallbackHours for %s', (_label, value) => {
        const start = resolvePeriodStart(value, { fallbackHours: 24 });

        expect(NOW.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
      });

      it('honours each caller\'s own fallback', () => {
        // The three workers deliberately differ: 24h for notification
        // summaries, 30d for cost and behaviour analytics.
        const notification = resolvePeriodStart(undefined, { fallbackHours: 24 });
        const analytics = resolvePeriodStart(undefined, { fallbackHours: 30 * HOURS_PER_DAY });

        expect(NOW.getTime() - notification.getTime()).toBe(24 * 60 * 60 * 1000);
        expect(NOW.getTime() - analytics.getTime()).toBe(30 * HOURS_PER_DAY * 60 * 60 * 1000);
      });

      it('rejects a missing fallback rather than inventing one', () => {
        // Silently picking a default window is exactly how CostMarginWorker
        // came to mislabel its output.
        expect(() => resolvePeriodStart('week', {})).toThrow(TypeError);
        expect(() => resolvePeriodStart('week', { fallbackHours: 'lots' })).toThrow(TypeError);
      });
    });

    it('never returns a start in the future', () => {
      for (const period of [...SUPPORTED_PERIODS, 'nonsense', undefined]) {
        expect(resolvePeriodStart(period, { fallbackHours: 24 }).getTime()).toBeLessThanOrEqual(NOW.getTime());
      }
    });
  });

  describe('isSupportedPeriod', () => {
    it.each(SUPPORTED_PERIODS)('recognises %s', (period) => {
      expect(isSupportedPeriod(period)).toBe(true);
    });

    it.each([
      ['an unknown name', 'fortnight'],
      ['undefined', undefined],
      ['a number', 7],
      ['an inherited property', 'constructor'],
    ])('rejects %s', (_label, value) => {
      expect(isSupportedPeriod(value)).toBe(false);
    });
  });

  describe('the vocabulary itself', () => {
    it('is exactly the four periods the workers accept', () => {
      expect([...SUPPORTED_PERIODS].sort()).toEqual(['month', 'today', 'week', 'yesterday']);
    });
  });
});
