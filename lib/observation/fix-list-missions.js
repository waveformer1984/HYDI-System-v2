'use strict';

/**
 * fix-list v2 — propose awaiting_approval missions from ranked fix-list items.
 * Separate from fix-list.js (v1 stays read-only). Never executes commands here.
 */

const fs = require('fs');
const path = require('path');

const STATE_NAME = 'proposed-missions.json';
const MIN_PASSES = 2;

function loadState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, STATE_NAME), 'utf8'));
  } catch {
    return { proposed: {} };
  }
}

function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${STATE_NAME}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, path.join(dir, STATE_NAME));
}

function actionFromProposedFix(proposedFix, bootModuleIds) {
  if (!proposedFix || proposedFix.type === 'human') return null;
  const cmd = proposedFix.command || '';
  const restart = cmd.match(/^pm2 restart ([\w-]+)$/);
  if (restart && bootModuleIds.has(restart[1])) {
    return {
      type: 'run_script',
      target: 'scripts/restart-module.js',
      args: [restart[1]],
    };
  }
  return null;
}

/**
 * @param {object} fixList output of buildFixList
 * @param {object} deps { memory, bootConfigPath, fixlistDir, minPasses, actor, now }
 * @returns {Promise<{ proposed: number, skipped: number, ids: number[] }>}
 */
async function proposeMissionsFromFixList(fixList, deps = {}) {
  const dir = deps.fixlistDir || path.join(process.cwd(), '.runtime', 'fixlist');
  const state = loadState(dir);
  const minPasses = deps.minPasses ?? MIN_PASSES;
  const bootIds = new Set();
  try {
    const boot = JSON.parse(fs.readFileSync(deps.bootConfigPath || path.join(process.cwd(), 'boot.config.json'), 'utf8'));
    for (const m of boot.modules || []) bootIds.add(m.id);
  } catch { /* no boot config */ }

  const memory = deps.memory;
  if (!memory?.createMission) {
    return { proposed: 0, skipped: 0, ids: [], error: 'memory_unavailable' };
  }

  let proposed = 0;
  let skipped = 0;
  const ids = [];
  const items = fixList?.items || [];

  for (const item of items) {
    if (item.level !== 'CRIT' || (item.passes || 0) < minPasses) {
      skipped += 1;
      continue;
    }
    if (state.proposed[item.id]) {
      skipped += 1;
      continue;
    }
    const pf = item.proposedFix || {};
    const action = actionFromProposedFix(pf, bootIds);
    const goal = `Fix-list (${item.kind}): ${item.detail}`.slice(0, 500);
    const context = {
      fix_list: { id: item.id, kind: item.kind, subject: item.subject, proposedFix: pf },
      success: { exitCode: 0 },
    };
    if (action) context.action = action;

    const missionId = await memory.createMission(
      goal,
      pf.risk === 'R1' ? 2 : 1,
      context,
      'Heidi',
      { actor: deps.actor || 'fix-list-missions', reason: `fix-list item ${item.id}` },
    );
    state.proposed[item.id] = { missionId, at: (deps.now || new Date()).toISOString() };
    ids.push(missionId);
    proposed += 1;
  }

  if (proposed > 0) saveState(dir, state);
  return { proposed, skipped, ids };
}

module.exports = { proposeMissionsFromFixList, MIN_PASSES, loadState };
