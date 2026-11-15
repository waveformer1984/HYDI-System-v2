'use strict';

/**
 * PROPOSED dispatcher migration — audit only. Execution paths are unchanged.
 * Scope: single surface HEIDI_CORE_CHAT_TOOLS for future central routing.
 */

const { SURFACES } = require('./inference-route');

const PROPOSAL_SCHEMA_VERSION = 1;
const MIGRATION_SURFACE = SURFACES.HEIDI_CORE_CHAT_TOOLS;

function proposedDispatcherDecision(surface, env = process.env) {
  if (surface !== MIGRATION_SURFACE) {
    return {
      schema_version: PROPOSAL_SCHEMA_VERSION,
      execution_changed: false,
      in_migration_scope: false,
      would_dispatch_to: null,
      rollback: 'no-op — existing POST /chat-tools unchanged',
    };
  }
  return {
    schema_version: PROPOSAL_SCHEMA_VERSION,
    execution_changed: false,
    in_migration_scope: true,
    would_dispatch_to: {
      module: 'heidi-core/server.js',
      route: 'POST /chat-tools',
      provider: 'ollama-via-existing-brain',
    },
    note: 'Future dispatcher would wrap existing handler; this object is compatibility metadata only.',
    rollback: 'unset HYDI_INFERENCE_DISPATCH_PROPOSAL=1 or remove dispatcher shim',
  };
}

module.exports = {
  PROPOSAL_SCHEMA_VERSION,
  MIGRATION_SURFACE,
  proposedDispatcherDecision,
};