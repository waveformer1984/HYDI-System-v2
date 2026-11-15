'use strict';

/**
 * Static priority ranking for capability verification gaps (audit aid).
 * Does not execute capabilities.
 */

const CAPABILITY_GAP_RANKING = Object.freeze([
  {
    priority: 1,
    category: 'state_mutating_authorization',
    impact: 'Writes or deletes without verification/undo',
    examples: ['tool.update_database', 'tool.create_task', 'commercial.stripe'],
  },
  {
    priority: 2,
    category: 'execution_result_accuracy',
    impact: 'Side effects with no observer',
    examples: ['tool.send_email', 'communication.send_message'],
  },
  {
    priority: 3,
    category: 'read_with_downstream_action',
    impact: 'Read paths that gate mutations',
    examples: ['tool.fetch_data', 'world.observe'],
  },
]);

module.exports = { CAPABILITY_GAP_RANKING };