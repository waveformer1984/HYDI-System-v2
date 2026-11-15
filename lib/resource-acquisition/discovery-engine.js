'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { INTAKE_KIND, SOURCE_VERIFICATION_STATUS } = require('../partnerships-funding/source-verification');
const { validateOpportunityIntake } = require('./opportunity-schema');

const SEED_DIR = path.join(__dirname, 'seeds');

function jobId(prefix = 'discover') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Curated discovery — seeds + optional operator JSON dir. No web scrape in this path.
 */
class ResourceDiscoveryEngine {
  constructor({ coordinator, operatorIntakeDir = process.env.HYDI_RESOURCE_INTAKE_DIR } = {}) {
    if (!coordinator) throw new Error('coordinator_required');
    this.coordinator = coordinator;
    this.operatorIntakeDir = operatorIntakeDir;
  }

  listSeedFiles() {
    return fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));
  }

  loadSeeds() {
    const all = [];
    for (const file of this.listSeedFiles()) {
      const rows = JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), 'utf8'));
      for (const row of rows) all.push(row);
    }
    return all;
  }

  loadOperatorIntake() {
    if (!this.operatorIntakeDir || !fs.existsSync(this.operatorIntakeDir)) return [];
    const files = fs.readdirSync(this.operatorIntakeDir).filter((f) => f.endsWith('.json'));
    const rows = [];
    for (const f of files) {
      rows.push(JSON.parse(fs.readFileSync(path.join(this.operatorIntakeDir, f), 'utf8')));
    }
    return rows;
  }

  discoverBatch({ includeSeeds = true, includeOperator = true, includeFixtures = false, fixtureDiscover } = {}) {
    const trace_id = jobId('discover');
    const started = new Date().toISOString();
    const sources = [];
    if (includeSeeds) sources.push(...this.loadSeeds());
    if (includeOperator) sources.push(...this.loadOperatorIntake());
    const results = [];
    let fixtureResult = null;
    if (includeFixtures && typeof fixtureDiscover === 'function') {
      fixtureResult = fixtureDiscover();
    }

    for (const raw of sources) {
      const v = validateOpportunityIntake(raw);
      if (!v.ok) {
        results.push({ ok: false, error: 'invalid_intake', fields: v.errors, program_name: raw.program_name });
        continue;
      }
      const input = {
        ...raw,
        intake_kind: raw.intake_kind || INTAKE_KIND.OPERATOR_CURATED,
        source_verification_status: raw.source_verification_status || SOURCE_VERIFICATION_STATUS.EXAMPLE_UNVERIFIED,
        research_classification: raw.research_classification || 'CURATED_SEED_UNVERIFIED',
        benefit_category: raw.benefit_category || raw.opportunity_category,
        source_verified_at: raw.source_verified_at ?? null,
      };
      results.push(this.coordinator.discoverFromSource(input));
    }

    return {
      ok: true,
      trace_id,
      started_at: started,
      completed_at: new Date().toISOString(),
      intake_count: sources.length,
      results,
      fixtures: fixtureResult,
      classification: 'CURATED_DISCOVERY',
      live_verified: false,
    };
  }
}

module.exports = { ResourceDiscoveryEngine, jobId };