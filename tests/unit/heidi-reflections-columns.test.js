'use strict';

// heidi_reflections has fixed columns (id, task_id, theme, confidence,
// was_correct, overconfidence_detected, confidence_justified,
// gating_appropriate, historical_influence, evaluations, timestamp,
// created_at, cycle). The agent's reflection writers used to send
// `reflection`/`event_range` keys that do not exist — every insert failed
// with "Could not find the '...' column of 'heidi_reflections' in the schema
// cache" (~237 errors in PM2 logs). This pins payloads to the real columns.

const HeidiAgent = require('../../heidi-core/heidi-agent.js');

const REAL_COLUMNS = new Set([
  'id', 'task_id', 'theme', 'confidence', 'was_correct',
  'overconfidence_detected', 'confidence_justified', 'gating_appropriate',
  'historical_influence', 'evaluations', 'timestamp', 'created_at', 'cycle',
]);
const NOT_NULL = ['task_id', 'theme', 'confidence', 'was_correct', 'cycle'];

function fakeSupabase({ events = [], captured = [] }) {
  return {
    from: (table) => {
      if (table === 'heidi_events') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: events, error: null }) }),
            }),
          }),
        };
      }
      if (table === 'heidi_reflections') {
        return {
          insert: async (row) => { captured.push(row); return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const EVENTS = [
  { id: 'e2', verdict: 'AUTO-APPROVE', created_at: '2026-11-21T00:00:00Z' },
  { id: 'e1', verdict: 'BLOCK', created_at: '2026-11-20T00:00:00Z' },
];

test('writeMinimalReflection inserts only real heidi_reflections columns', async () => {
  const captured = [];
  const agent = Object.create(HeidiAgent.prototype);
  agent.supabase = fakeSupabase({ captured });
  agent.stats = { reflectionsCycled: 0 };

  await agent.writeMinimalReflection(7);

  expect(captured).toHaveLength(1);
  const row = captured[0];
  for (const key of Object.keys(row)) expect(REAL_COLUMNS.has(key)).toBe(true);
  for (const key of NOT_NULL) expect(row).toHaveProperty(key);
  expect(row.evaluations).toBeTruthy();
});

test('reflect() inserts only real heidi_reflections columns', async () => {
  const captured = [];
  const agent = Object.create(HeidiAgent.prototype);
  agent.leaseClaimed = true;
  agent.supabase = fakeSupabase({ events: EVENTS, captured });
  agent.stats = { reflectionsCycled: 3, tasksProcessed: 0, tasksReviewed: 0, tasksBlocked: 0 };

  await agent.reflect();

  expect(captured).toHaveLength(1);
  const row = captured[0];
  for (const key of Object.keys(row)) expect(REAL_COLUMNS.has(key)).toBe(true);
  for (const key of NOT_NULL) expect(row).toHaveProperty(key);
  expect(row.evaluations.patterns).toBeTruthy();
});
