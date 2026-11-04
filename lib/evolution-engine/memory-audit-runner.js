'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Live Heidi memory audit for evolution (same 7 checks as chat `memory audit`).
 * @param {{ repoRoot?: string, dbPath?: string }} [opts]
 */
function createMemoryAuditRunner(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const dbPath = opts.dbPath
    || process.env.HEIDI_DB_PATH
    || path.join(repoRoot, 'heidi-core/data/heidi_memory.db');

  return async function runMemoryAudit() {
    if (!fs.existsSync(dbPath)) {
      return {
        passed: 0,
        total: 0,
        results: [['database', 'FAIL (missing db)']],
        memory_retrieval_accuracy: 'not_measured',
        skipped: true,
      };
    }
    const { MemoryRuntime } = require('../../heidi-core/memory/memory-runtime');
    const { runStructuredMemoryAudit } = require('../../heidi-core/memory/memory-commands');
    const rt = new MemoryRuntime({ dbPath, root: repoRoot });
    if (!rt.store) {
      return {
        passed: 0,
        total: 0,
        results: [['database', `FAIL (${rt.storeError})`]],
        memory_retrieval_accuracy: 'not_measured',
        skipped: true,
      };
    }
    return runStructuredMemoryAudit(rt.store);
  };
}

module.exports = { createMemoryAuditRunner };
