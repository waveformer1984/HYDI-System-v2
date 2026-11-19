'use strict';

/**
 * File-backed revenue ledger — cleared payments only increase distributable profit.
 * Hardware reserve uses realized profit, not gross revenue.
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

function recordClearedPayment(ledger, { amountUsd, stripePaymentId, note }) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw Object.assign(new Error('invalid_amount'), { code: 'INVALID_AMOUNT' });
  }
  if (!stripePaymentId || typeof stripePaymentId !== 'string') {
    throw Object.assign(new Error('payment_id_required'), { code: 'PAYMENT_ID_REQUIRED' });
  }
  ledger.clearedPaymentsUsd += amountUsd;
  ledger.grossRevenueUsd += amountUsd;
  ledger.entries.push({
    type: 'cleared_payment',
    amountUsd,
    stripePaymentId,
    note: note || '',
    at: new Date().toISOString(),
  });
  return ledger;
}

function netOperatingProfit(ledger) {
  return (
    ledger.clearedPaymentsUsd
    - ledger.refundsUsd
    - ledger.processingFeesUsd
    - ledger.operatingCostsUsd
    - ledger.taxesReservedUsd
  );
}

function hardwareReservePlan(ledger, allocation = ledger.allocation || DEFAULT_ALLOCATION) {
  const net = Math.max(0, netOperatingProfit(ledger));
  return {
    netOperatingProfitUsd: net,
    hardwareTargetUsd: ledger.hardwareTargetUsd || HARDWARE_TARGET_USD,
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
    grossRevenueUsd: ledger.grossRevenueUsd,
    clearedPaymentsUsd: ledger.clearedPaymentsUsd,
    netOperatingProfitUsd: netOperatingProfit(ledger),
    entryCount24h: ledger.entries.filter((e) => Date.now() - Date.parse(e.at) < 86400000).length,
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
};