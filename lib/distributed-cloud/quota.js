'use strict';

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./store');

function loadConfig() {
  const file = path.join(repoRoot(), 'config', 'distributed-cloud.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hourKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 13);
}

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function rollBudgetCounters(state, now) {
  const hk = hourKey(now);
  const dk = dayKey(now);
  if (state.budgets.hourKey !== hk) {
    state.budgets.hourKey = hk;
    state.budgets.tasksThisHour = 0;
  }
  if (state.budgets.dayKey !== dk) {
    state.budgets.dayKey = dk;
    state.budgets.paidUsdToday = 0;
  }
}

/**
 * Fail-closed when zero-cost budgets would be exceeded. Never triggers paid upgrades.
 */
function checkQuota(state, { costUsd = 0, env = process.env, now = Date.now() } = {}) {
  rollBudgetCounters(state, now);
  const cfg = loadConfig();
  const maxPaid = Number(cfg.budgets?.maxPaidUsdPerDay ?? 0);
  const maxHour = Number(cfg.budgets?.maxCloudTasksPerHour ?? 120);
  const zeroCost = cfg.zeroCostMode !== false && env.HYDI_ALLOW_PAID_LLM !== 'true';

  if (costUsd > 0 && (zeroCost || state.budgets.paidUsdToday + costUsd > maxPaid)) {
    return { ok: false, code: 'PAID_BUDGET_EXCEEDED', detail: 'Paid spend not authorized' };
  }
  if (state.budgets.tasksThisHour >= maxHour) {
    return { ok: false, code: 'HOURLY_TASK_CAP', detail: 'Approaching free-tier task cap; queue only' };
  }
  const alertPct = Number(cfg.budgets?.alertAtUtilizationPct ?? 80);
  const utilization = maxHour > 0 ? (state.budgets.tasksThisHour / maxHour) * 100 : 0;
  return {
    ok: true,
    utilizationPct: utilization,
    warn: utilization >= alertPct,
  };
}

function recordTaskEnqueue(state, { costUsd = 0, now = Date.now() } = {}) {
  rollBudgetCounters(state, now);
  state.budgets.tasksThisHour += 1;
  state.budgets.paidUsdToday += costUsd;
}

module.exports = { loadConfig, checkQuota, recordTaskEnqueue, hourKey, dayKey };