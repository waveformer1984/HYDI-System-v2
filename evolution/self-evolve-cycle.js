'use strict';
/**
 * Recurring self-evolution cycle: measure -> analyze -> recommend -> execute.
 *
 * Unlike run-full-cycle.js (a one-shot demo), this is safe to run on a schedule:
 * goal creation goes through findings-to-goals.proposeGoals(), which dedups against
 * existing active goals tagged with the same finding source, so re-running against
 * unchanged data does not spam duplicate goals.
 *
 *   node evolution/self-evolve-cycle.js
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY, the local
 * Supabase CLI's newer name for the same role) from .env.local / .env / the shell.
 */
(() => {
  try {
    const dotenv = require('dotenv');
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const candidates = process.env.SUPABASE_ENV_FILE
      ? [process.env.SUPABASE_ENV_FILE]
      : ['.env.local', '.env'].map((f) => path.join(root, f));
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        Object.assign(process.env, dotenv.parse(fs.readFileSync(file)));
        break;
      }
    }
  } catch (_) { /* dotenv optional */ }
})();

const { createClient } = require('@supabase/supabase-js');
const { assessFromSupabase } = require('./self-assessment');
const { proposeGoals } = require('./findings-to-goals');
const HeidiGoalEngine = require('./heidi-goals');
const GoalExecutor = require('./goal-executor');

const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

function ts() { return new Date().toISOString(); }

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error(`[${ts()}] Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
    process.exit(1);
  }
  const supabase = createClient(url, key);
  console.log(`[${ts()}] self-evolve-cycle target: ${new URL(url).host}`);

  // ── Measure + Analyze ────────────────────────────────────────────────────
  const report = await assessFromSupabase(supabase, { windowHours: 24 });
  console.log(`[${ts()}] events=${report.total_events} error_rate=${(report.error_rate * 100).toFixed(1)}% p95=${report.latency_ms.p95}ms`);
  for (const f of report.findings) console.log(`  [${f.severity}] ${f.message}`);

  // ── Recommend (deduped) ──────────────────────────────────────────────────
  const brain = {
    generate: async (prompt) => {
      const r = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      });
      const result = await r.json();
      return { text: result.response };
    },
  };
  const memory = { store: async () => true };
  const goalEngine = new HeidiGoalEngine(brain, memory);
  await goalEngine.initialize();

  const { created, proposals } = await proposeGoals(goalEngine, report, { approve: true });
  console.log(`[${ts()}] proposals=${proposals.length} new_goals=${created.length}`);
  for (const g of created) console.log(`  + ${g.id}: ${g.objective}`);

  // ── Execute (safety-gated) ───────────────────────────────────────────────
  const goalExecutor = new GoalExecutor(goalEngine);
  const activeBefore = goalEngine.getActiveGoals().length;
  const summary = await goalExecutor.executeAllActiveGoals();
  console.log(`[${ts()}] executed ${activeBefore} active goal(s):`);
  for (const r of summary.results) {
    console.log(`  ${r.status === 'completed' ? 'OK' : r.status.toUpperCase()} ${r.objective} (${r.completedTasks}/${r.totalTasks} tasks)`);
  }

  const archived = goalEngine.archiveCompleted();
  if (archived) console.log(`[${ts()}] archived ${archived} completed goal(s)`);

  console.log(`[${ts()}] cycle complete`);
}

main().catch((e) => {
  console.error(`[${ts()}] self-evolve-cycle error:`, e.message);
  process.exit(1);
});
