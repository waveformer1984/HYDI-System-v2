'use strict';

/**
 * Integer money helpers. Every balance in the billing module is an integer
 * count of minor units (cents) or micro-units (provider costs). Nothing here
 * accepts or produces a fractional amount.
 */

const { BillingError } = require('./errors');

const CURRENCY_RE = /^[a-z]{3}$/;

/** Throws unless `value` is a safe, non-negative integer. */
function assertMinor(value, field = 'amount') {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new BillingError('invalid_amount', `${field} must be a non-negative integer number of minor units`, 400);
  }
  return value;
}

/**
 * Converts a database integer (pg returns int8 as string) to a JS number,
 * refusing anything outside the safe-integer range rather than silently
 * losing precision.
 */
function toSafeInt(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`unsafe integer: ${value}`);
    return value;
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || String(n) !== String(value).replace(/^\+/, '')) {
    throw new Error(`integer out of safe range: ${value}`);
  }
  return n;
}

function normalizeCurrency(currency) {
  const c = String(currency || '').toLowerCase();
  if (!CURRENCY_RE.test(c)) throw new BillingError('invalid_currency', 'currency must be a 3-letter ISO 4217 code', 400);
  return c;
}

/**
 * Sums integer amounts per currency. Returns { [currency]: total }. Mixed
 * currencies are never added together — there is no conversion policy.
 */
function sumByCurrency(rows, amountOf, currencyOf) {
  const out = {};
  for (const row of rows) {
    const amount = amountOf(row);
    if (amount === null || amount === undefined) continue;
    const cur = currencyOf(row);
    out[cur] = (out[cur] || 0) + toSafeInt(amount);
    if (!Number.isSafeInteger(out[cur])) throw new Error('sum overflowed safe integer range');
  }
  return out;
}

/** Formats minor units for display only (never for arithmetic). */
function formatMinor(amountMinor, currency) {
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}${major}.${minor} ${String(currency).toUpperCase()}`;
}

module.exports = { assertMinor, toSafeInt, normalizeCurrency, sumByCurrency, formatMinor };
