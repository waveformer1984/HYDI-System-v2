'use strict';

function parseDeadline(deadline) {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  return Number.isFinite(t) ? t : null;
}

function portfolioSnapshot(state, { now = Date.now() } = {}) {
  const ops = state.opportunities || [];
  const upcoming = [];
  for (const o of ops) {
    const t = parseDeadline(o.deadline);
    if (t && t > now) upcoming.push({ id: o.id, program_name: o.program_name, deadline: o.deadline, ms: t - now });
  }
  upcoming.sort((a, b) => a.ms - b.ms);

  const byState = {};
  for (const o of ops) {
    byState[o.pipeline_state] = (byState[o.pipeline_state] || 0) + 1;
  }

  return {
    ok: true,
    total: ops.length,
    by_pipeline_state: byState,
    upcoming_deadlines: upcoming.slice(0, 10),
    awaiting_owner: ops.filter((o) => o.pipeline_state === 'needs_owner_information' || o.pipeline_state === 'awaiting_approval'),
    research_empty: ops.length === 0,
    classification: 'VERIFIED_SIMULATED',
  };
}

module.exports = { portfolioSnapshot, parseDeadline };