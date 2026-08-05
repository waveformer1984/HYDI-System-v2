'use strict';

/**
 * Shared resolution of the `time_period` payload field to a window start.
 *
 * `time_period` is part of the worker event vocabulary — analytics, summary
 * and behaviour-analysis events all carry it — but every consumer resolved it
 * independently. `NotificationWorker` and `BehaviorPatternWorker` each had
 * their own copy of the same if/else chain (and had already drifted:
 * `yesterday` was only understood by one of them), while `CostMarginWorker`
 * ignored the field entirely and always queried a hardcoded 30 days, then
 * labelled the stored `cost_analytics` row with whatever period had been
 * requested. A caller asking for a week of data got a month of data filed
 * under `time_period: 'week'`.
 *
 * The vocabulary lives here so it resolves the same way everywhere. Callers
 * supply their own `fallbackHours` for an unrecognised or absent value, since
 * the existing workers deliberately differ on that (24h for notification
 * summaries, 30d for cost and behaviour analytics).
 */

/**
 * Named periods, each returning the start of its window relative to now.
 * @type {Record<string, () => Date>}
 */
const PERIOD_STARTS = Object.freeze({
  today: () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  },
  yesterday: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  week: () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  },
  month: () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  },
});

/** The period names this module understands. */
const SUPPORTED_PERIODS = Object.freeze(Object.keys(PERIOD_STARTS));

/** Hours in a day, for callers expressing their fallback in days. */
const HOURS_PER_DAY = 24;

/**
 * Resolve a `time_period` value to the start of its window.
 *
 * @param {string|undefined|null} timePeriod one of SUPPORTED_PERIODS
 * @param {object} options
 * @param {number} options.fallbackHours how far back to look when
 *   `timePeriod` is absent or unrecognised. Required — there is no sensible
 *   universal default, and silently picking one is what let CostMarginWorker
 *   mislabel its output.
 * @returns {Date} the inclusive start of the window
 */
function resolvePeriodStart(timePeriod, { fallbackHours }) {
  if (typeof fallbackHours !== 'number' || !Number.isFinite(fallbackHours)) {
    throw new TypeError('resolvePeriodStart requires a numeric fallbackHours');
  }

  const start = PERIOD_STARTS[timePeriod];
  if (start) return start();

  const d = new Date();
  d.setHours(d.getHours() - fallbackHours);
  return d;
}

/**
 * Whether a value is a period name this module understands. Useful for
 * distinguishing "caller asked for something we don't support" from "caller
 * omitted the field", which `resolvePeriodStart` deliberately treats alike.
 *
 * @param {unknown} timePeriod
 * @returns {boolean}
 */
function isSupportedPeriod(timePeriod) {
  return typeof timePeriod === 'string' && Object.prototype.hasOwnProperty.call(PERIOD_STARTS, timePeriod);
}

module.exports = {
  PERIOD_STARTS,
  SUPPORTED_PERIODS,
  HOURS_PER_DAY,
  resolvePeriodStart,
  isSupportedPeriod,
};
