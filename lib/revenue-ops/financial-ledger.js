'use strict';

/**
 * File-backed revenue ledger — cleared payments only after Stripe verification.
 * Hardware reserve uses live cleared profit, not test mode entries.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOCATION = Object.freeze({
  hardwareExpansion: 0.5,
  operatingReserve: 0.3,
  businessDevelopment: 0.2,
});

const HARDWARE_TARGET_USD = 5000;

function ledgerDir(env = process.env) {
  const root = path.resolve(__dirname, '..', '..');
  return env.REVENUE_LEDGER_DIR
    ? path.resolve(env.REVENUE_LEDGER_DIR)
    : path.join(root, '.runtime', 'revenue-ledger');
}

function loadLedger(dir) {
  const file = path.join(dir, 'ledger.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {
      grossRevenueUsd: 0,
      clearedPaymentsUsd: 0,
      testClearedPaymentsUsd: 0,
      refundsUsd: 0,
      processingFeesUsd: 0,
      operatingCostsUsd: 0,
      taxesReservedUsd: 0,
      entries: [],
      hardwareTargetUsd: HARDWARE_TARGET_USD,
      allocation: { ...DEFAULT_ALLOCATION },
    };
  }
}

function saveLedger(dir, ledger) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ledger.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, file);
}

function liveClearedTotal(ledger) {
  return (ledger.entries || [])
    .filter((e) => e.type === 'cleared_payment' && !e.testMode)
    .reduce((sum, e) => sum + e.amountUsd, 0);
}

/**
 * @param {object} ledger
 * @param {{ stripePaymentId: string, note?: string, amountUsd?: number, env?: NodeJS.ProcessEnv, stripe?: object }} params
 */
async function recordClearedPayment(ledger, params) {
  const env = params.env || process.env;
  const stripePaymentId = params.stripePaymentId;
  if (!stripePaymentId || typeof stripePaymentId !== 'string') {
    throw Object.assign(new Error('payment_id_required'), { code: 'PAYMENT_ID_REQUIRED' });
  }
  const key = env.STRIPE_SECRET_KEY;
  if (!key || typeof key !== 'string') {
    throw Object.assign(new Error('stripe_key_required'), { code: 'STRIPE_KEY_REQUIRED' });
  }

  const stripe =
    params.stripe ||
    require('stripe')(key, { maxNetworkRetries: 0 });

  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(stripePaymentId);
  } catch (err) {
    throw Object.assign(new Error('stripe_retrieve_failed'), {
      code: 'STRIPE_RETRIEVE_FAILED',
      cause: err instanceof Error ? err.message : 'unknown',
    });
  }

  if (pi.status !== 'succeeded') {
    throw Object.assign(new Error('payment_not_succeeded'), { code: 'PAYMENT_NOT_SUCCEEDED' });
  }

  const testMode = !pi.livemode;
  const allowTest = env.LEDGER_ALLOW_TEST === 'true' || env.LEDGER_ALLOW_TEST === true;
  if (testMode && !allowTest) {
    throw Object.assign(new Error('test_mode_not_allowed'), { code: 'TEST_MODE_REJECTED' });
  }

  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  if (!chargeId) {
    throw Object.assign(new Error('missing_charge'), { code: 'MISSING_CHARGE' });
  }

  const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
  let bt = charge.balance_transaction;
  if (typeof bt === 'string') {
    bt = await stripe.balanceTransactions.retrieve(bt);
  }
  if (!bt || bt.status !== 'available') {
    throw Object.assign(new Error('balance_not_available'), { code: 'BALANCE_NOT_AVAILABLE' });
  }

  const amountUsd = pi.amount_received / 100;
  if (params.amountUsd !== undefined && Math.abs(params.amountUsd - amountUsd) > 0.01) {
    throw Object.assign(new Error('amount_mismatch'), { code: 'AMOUNT_MISMATCH' });
  }

  ledger.entries = ledger.entries || [];
  if (ledger.entries.some((e) => e.stripePaymentId === stripePaymentId && e.type === 'cleared_payment')) {
    throw Object.assign(new Error('duplicate_payment'), { code: 'DUPLICATE_PAYMENT' });
  }

  if (testMode) {
    ledger.testClearedPaymentsUsd = (ledger.testClearedPaymentsUsd || 0) + amountUsd;
  } else {
    ledger.clearedPaymentsUsd = (ledger.clearedPaymentsUsd || 0) + amountUsd;
    ledger.grossRevenueUsd = (ledger.grossRevenueUsd || 0) + amountUsd;
  }

  ledger.entries.push({
    type: 'cleared_payment',
    amountUsd,
    stripePaymentId,
    testMode,
    note: params.note || '',
    balanceTransactionStatus: bt.status,
    at: new Date().toISOString(),
  });

  ledger.clearedPaymentsUsd = liveClearedTotal(ledger);
  return ledger;
}

function netOperatingProfit(ledger) {
  const cleared = liveClearedTotal(ledger);
  return (
    cleared
    - (ledger.refundsUsd || 0)
    - (ledger.processingFeesUsd || 0)
    - (ledger.operatingCostsUsd || 0)
    - (ledger.taxesReservedUsd || 0)
  );
}

function hardwareReservePlan(ledger, allocation = ledger.allocation || DEFAULT_ALLOCATION) {
  const net = Math.max(0, netOperatingProfit(ledger));
  return {
    netOperatingProfitUsd: net,
    hardwareTargetUsd: ledger.hardwareTargetUsd || HARDWARE_TARGET_USD,
    testClearedPaymentsUsd: ledger.testClearedPaymentsUsd || 0,
    buckets: {
      hardwareExpansionUsd: net * (allocation.hardwareExpansion || 0),
      operatingReserveUsd: net * (allocation.operatingReserve || 0),
      businessDevelopmentUsd: net * (allocation.businessDevelopment || 0),
    },
    policyNote: 'Planning only — owner approval required before any spend or hardware purchase.',
  };
}

function dailyReport(ledger) {
  return {
    generatedAt: new Date().toISOString(),
    grossRevenueUsd: ledger.grossRevenueUsd || 0,
    clearedPaymentsUsd: liveClearedTotal(ledger),
    testClearedPaymentsUsd: ledger.testClearedPaymentsUsd || 0,
    netOperatingProfitUsd: netOperatingProfit(ledger),
    entryCount24h: (ledger.entries || []).filter((e) => Date.now() - Date.parse(e.at) < 86400000).length,
  };
}

module.exports = {
  DEFAULT_ALLOCATION,
  HARDWARE_TARGET_USD,
  ledgerDir,
  loadLedger,
  saveLedger,
  recordClearedPayment,
  netOperatingProfit,
  hardwareReservePlan,
  dailyReport,
  liveClearedTotal,
};