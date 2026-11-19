#!/usr/bin/env node
'use strict';

/**
 * Seeds 10 QUALIFIED San Antonio detailer prospects (synthetic public-style records).
 * Does not send outreach — CONTACT requires owner approval in customer-pipeline.
 */

const fs = require('fs');
const path = require('path');
const {
  pipelineDir,
  loadProspects,
  saveProspects,
  addProspect,
  transitionProspect,
} = require('../lib/revenue-ops/customer-pipeline');

const SEED = [
  { businessName: 'Alamo Mobile Detail', website: null, problem: 'Phone-only booking' },
  { businessName: 'Riverwalk Auto Spa', website: null, problem: 'No follow-up after quote' },
  { businessName: 'Southtown Shine Co', website: null, problem: 'Weekend demand overflow' },
  { businessName: 'Stone Oak Detailing', website: null, problem: 'Missed evening calls' },
  { businessName: 'Westside Wash & Wax', website: null, problem: 'Manual scheduling' },
  { businessName: 'Pearl District Polish', website: null, problem: 'No online deposit' },
  { businessName: 'Lone Star Ceramic Pro SA', website: null, problem: 'Lead response delay' },
  { businessName: 'Helotes Fleet Shine', website: null, problem: 'Fleet scheduling chaos' },
  { businessName: 'Converse Quick Detail', website: null, problem: 'No CRM' },
  { businessName: 'Boerne Auto Aesthetics', website: null, problem: 'Seasonal slump outreach' },
];

function main() {
  const dir = pipelineDir();
  const data = loadProspects(dir);
  for (const row of SEED) {
    const p = addProspect(data, {
      ...row,
      evidence: [{ type: 'HYPOTHESIS', note: 'Identified via local search category; verify before contact' }],
      nextAction: 'Confirm website and owner name from public directory',
    });
    transitionProspect(data, p.id, 'RESEARCHED', { actor: 'revenue_agent', reason: 'seed' });
    transitionProspect(data, p.id, 'QUALIFIED', { actor: 'revenue_agent', reason: 'seed' });
  }
  saveProspects(dir, data);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, count: data.prospects.length, dir }, null, 2));
}

if (require.main === module) main();

module.exports = { SEED, main };