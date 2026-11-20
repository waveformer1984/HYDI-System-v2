'use strict';

/**
 * Job Scout → specialist pool: parallel scout/researcher subtasks; verifier proposes evidence only (never auto-QUALIFY).
 */

const { SpecialistPool } = require('../dev-workforce/pool');
const { MemoryTaskStore } = require('../execution-fabric/task-store-memory');
const { ExecutionGateway } = require('../execution-fabric/gateway');
const { scoutDir } = require('./scout');
const fs = require('fs');
const path = require('path');

function detailerProspects(env = process.env) {
  const dir = scoutDir(env);
  const file = path.join(dir, 'leads.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const leads = Array.isArray(data.leads) ? data.leads : data;
  return leads.filter((l) => {
    const div = String(l.division || l.profile || '').toLowerCase();
    const title = String(l.title || '').toLowerCase();
    return div.includes('detailer') || title.includes('detail');
  });
}

/**
 * @param {object} [opts]
 * @param {SpecialistPool} [opts.pool]
 * @param {object} [opts.env]
 */
async function enqueueJobScoutPoolMission(opts = {}) {
  const env = opts.env || process.env;
  const started = Date.now();
  const prospects = detailerProspects(env).slice(0, 8);
  const pool = opts.pool || new SpecialistPool({
    store: new MemoryTaskStore(),
    gateway: new ExecutionGateway({ store: new MemoryTaskStore(), skipRecovery: true }),
    planFn: async () => {
      const scoutTasks = prospects.map((p, i) => ({
        template: 'scout',
        title: `fetch listing ${i + 1}`,
        args: { url: p.url || p.link || `https://example.com/scout/${i}` },
        acceptance_criteria: 'HTTP 200 and non-empty body',
        subtask_id: `scout-${i}`,
      }));
      const researchTasks = prospects.map((p, i) => ({
        template: 'researcher',
        title: `research prospect ${i + 1}`,
        args: {
          prompt: `Summarize public listing for verification (no qualify): ${p.title || 'unknown'} ${p.url || ''}`,
        },
        acceptance_criteria: 'Summary cites only public facts',
        subtask_id: `research-${i}`,
      }));
      return [...scoutTasks, ...researchTasks].slice(0, 20);
    },
  });

  const before = Date.now();
  const enq = await pool.enqueueMission({
    id: `job-scout-pool-${before}`,
    objective: 'Job Scout detailer prospects: parallel fetch + public listing research for Jordan verification',
  });
  const wallMs = Date.now() - started;
  return {
    ok: enq.ok,
    mission_id: enq.mission_id,
    subtasks_enqueued: enq.subtasks,
    prospects: prospects.length,
    wall_clock_ms: wallMs,
    note: 'VERIFIED evidence requires Jordan confirm — never auto-QUALIFY',
  };
}

module.exports = { enqueueJobScoutPoolMission, detailerProspects };