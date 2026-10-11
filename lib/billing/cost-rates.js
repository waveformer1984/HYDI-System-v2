'use strict';

/**
 * Provider cost rate card. Hydi does not ship any provider prices: rates are
 * operator-entered configuration with an explicit version string, so every
 * cost record says which rate card produced it. With no matching rate the
 * cost is recorded as `unpriced` (cost_micros NULL) — never guessed.
 *
 * BILLING_COST_RATES_JSON example (illustrative numbers, not real prices):
 *   {
 *     "version": "2026-10-01",
 *     "currency": "usd",
 *     "rates": {
 *       "ollama:*":            { "input_micros_per_million": 0, "output_micros_per_million": 0 },
 *       "anthropic:<model-id>": { "input_micros_per_million": 0, "output_micros_per_million": 0 }
 *     }
 *   }
 * Key lookup order: "<provider>:<model>", then "<provider>:*".
 */

function loadRateCard(json = process.env.BILLING_COST_RATES_JSON) {
  if (!json) return null;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed.version !== 'string' || typeof parsed.rates !== 'object') return null;
  return { version: parsed.version, currency: (parsed.currency || 'usd').toLowerCase(), rates: parsed.rates };
}

function isNonNegInt(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * Estimates the internal cost of one provider call.
 * @returns {{ costMicros: number|null, costStatus: 'estimated'|'unpriced', rateVersion: string|null, costCurrency: string }}
 */
function estimateCost(card, { provider, model, inputUnits, outputUnits }) {
  const rate = card && (card.rates[`${provider}:${model}`] || card.rates[`${provider}:*`]);
  if (!rate || !isNonNegInt(rate.input_micros_per_million) || !isNonNegInt(rate.output_micros_per_million)
    || !isNonNegInt(inputUnits || 0) || !isNonNegInt(outputUnits || 0)) {
    return { costMicros: null, costStatus: 'unpriced', rateVersion: card ? card.version : null, costCurrency: card ? card.currency : 'usd' };
  }
  // Round each component up to a whole micro-unit: integer arithmetic only.
  const part = (units, perMillion) => Math.ceil((units * perMillion) / 1000000);
  const costMicros = part(inputUnits || 0, rate.input_micros_per_million) + part(outputUnits || 0, rate.output_micros_per_million);
  return { costMicros, costStatus: 'estimated', rateVersion: card.version, costCurrency: card.currency };
}

module.exports = { loadRateCard, estimateCost };
