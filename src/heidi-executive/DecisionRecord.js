/**
 * HEIDI Operational Decision Engine — Immutable Decision Record
 */

const fs = require('fs');
const path = require('path');
const { SecretBroker } = require('./SecretBroker');

class DecisionRecord {
  constructor(options = {}) {
    this.dataDir = options.dataDir;
    this.redactor = options.redactor || new SecretBroker();
    if (this.dataDir) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  record(record) {
    const safe = this.redactor.redact(record);
    const entry = {
      decision_id: safe.decision_id || `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mission_id: safe.mission_id || null,
      incident_id: safe.incident_id || null,
      timestamp: new Date().toISOString(),
      observations: safe.observations || {},
      classification: safe.classification || {},
      impact: safe.impact || {},
      candidate_actions: safe.candidate_actions || [],
      selected_action: safe.selected_action || null,
      policy_result: safe.policy_result || null,
      authorization_result: safe.authorization_result || null,
      execution_result: safe.execution_result || null,
      verification_result: safe.verification_result || null,
      confidence: safe.confidence || 'LOW',
      final_state: safe.final_state || 'UNKNOWN',
    };

    if (this.dataDir) {
      const file = path.join(this.dataDir, 'decisions.jsonl');
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    }

    return entry;
  }
}

module.exports = { DecisionRecord };
