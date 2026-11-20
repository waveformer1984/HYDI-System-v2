'use strict';

const ORDER = ['new', 'scheduled', 'in_progress', 'done'];

const ACTIONS = {
  accept: { from: ['new'], to: 'scheduled' },
  schedule: { from: ['new', 'scheduled'], to: 'scheduled' },
  start: { from: ['scheduled'], to: 'in_progress' },
  complete: { from: ['in_progress'], to: 'done' },
  note: { from: ORDER, to: null },
};

function canTransition(fromStatus, action) {
  const rule = ACTIONS[action];
  if (!rule) return { ok: false, error: 'unknown_action' };
  if (!rule.from.includes(fromStatus)) return { ok: false, error: 'invalid_transition' };
  return { ok: true, next: rule.to ?? fromStatus };
}

function sortByStatus(rows) {
  const rank = Object.fromEntries(ORDER.map((s, i) => [s, i]));
  return [...rows].sort((a, b) => {
    const dr = (rank[a.crew_status] ?? 9) - (rank[b.crew_status] ?? 9);
    if (dr !== 0) return dr;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

module.exports = { ORDER, ACTIONS, canTransition, sortByStatus };