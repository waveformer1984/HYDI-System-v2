'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Persist verifiable evidence manifest per run (SLSA-inspired, redacted).
 */
class EvidenceBundle {
  /**
   * @param {{ rootDir?: string }} [opts]
   */
  constructor(opts = {}) {
    this.rootDir = opts.rootDir || path.join(process.cwd(), '.runtime', 'evolution', 'evidence');
  }

  ensureDirs() {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  /**
   * @param {object} manifest
   */
  write(manifest) {
    this.ensureDirs();
    const runId = manifest.run_id || 'unknown';
    const body = {
      schema: 'hydi-evolution-evidence/v1',
      written_at: new Date().toISOString(),
      ...manifest,
    };
    const json = JSON.stringify(body, null, 2);
    body.artifact_digest = crypto.createHash('sha256').update(json).digest('hex');
    const finalJson = JSON.stringify(body, null, 2);
    const file = path.join(this.rootDir, `${runId}.json`);
    fs.writeFileSync(file, finalJson);
    return { path: file, digest: body.artifact_digest, complete: this._completeness(body) };
  }

  load(runId) {
    const file = path.join(this.rootDir, `${runId}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  _completeness(body) {
    const required = ['run_id', 'initiator', 'approvals', 'base_sha', 'verification', 'outcome'];
    const missing = required.filter((k) => body[k] == null);
    return { ok: missing.length === 0, missing };
  }
}

module.exports = { EvidenceBundle };
