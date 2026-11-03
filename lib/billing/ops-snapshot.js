'use strict';

/**
 * Read-only billing ops counters for mobile surfaces (no secrets, no payloads).
 */

const STATUS_REL = '.runtime/billing/worker-status.json';

async function countByStatus(store, status) {
  if (!store?.findMany) return null;
  try {
    const rows = await store.findMany('billing_webhook_events', { status }, { limit: 10000 });
    return rows.length;
  } catch {
    return null;
  }
}

async function oldestDueRetryAgeSec(store, now = new Date()) {
  if (!store?.findMany) return null;
  try {
    const due = await store.findMany(
      'billing_webhook_events',
      { status: { in: ['received', 'failed', 'processing'] }, next_attempt_at: { lte: now } },
      { orderBy: ['next_attempt_at', 'asc'], limit: 1 },
    );
    if (!due.length) return 0;
    const t = new Date(due[0].next_attempt_at).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((now.getTime() - t) / 1000));
  } catch {
    return null;
  }
}

function readWorkerStatusFile(root) {
  const fs = require('fs');
  const path = require('path');
  try {
    const p = path.join(root || process.cwd(), STATUS_REL);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{ store?: object, root?: string, now?: Date }} [opts]
 */
async function getBillingOpsSnapshot(opts = {}) {
  const root = opts.root || process.cwd();
  const now = opts.now || new Date();
  const workerFile = readWorkerStatusFile(root);
  const store = opts.store;
  const deadLetter = store ? await countByStatus(store, 'dead_letter') : null;
  const failed = store ? await countByStatus(store, 'failed') : null;
  const dueRetryAgeSec = store ? await oldestDueRetryAgeSec(store, now) : null;
  const alert =
    (deadLetter != null && deadLetter > 0)
      ? `billing: ${deadLetter} webhook dead-letter(s)`
      : (workerFile?.lastReconcile?.errors?.length > 0)
        ? `billing: reconcile reported ${workerFile.lastReconcile.errors.length} error(s)`
        : null;
  return {
    dead_letter_count: deadLetter,
    failed_count: failed,
    due_retry_oldest_sec: dueRetryAgeSec,
    worker: workerFile
      ? {
          ts: workerFile.ts,
          last_reconcile: workerFile.lastReconcile
            ? {
                subscriptions_checked: workerFile.lastReconcile.subscriptions_checked,
                subscriptions_changed: workerFile.lastReconcile.subscriptions_changed,
                checkouts_checked: workerFile.lastReconcile.checkouts_checked,
                error_count: (workerFile.lastReconcile.errors || []).length,
              }
            : null,
        }
      : null,
    alert,
  };
}

function readBillingAlertSync(root) {
  const workerFile = readWorkerStatusFile(root);
  if (workerFile?.lastReconcile?.errors?.length > 0) {
    return `billing: reconcile reported ${workerFile.lastReconcile.errors.length} error(s)`;
  }
  return null;
}

module.exports = { getBillingOpsSnapshot, readBillingAlertSync, STATUS_REL };
