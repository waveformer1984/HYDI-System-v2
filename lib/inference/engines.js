'use strict';

/**
 * HYDI intelligence engine identifiers (multi-architecture router).
 * NCM is experimental — default routing remains LLM (Ollama) until benchmarks pass.
 */

const ENGINES = Object.freeze({
  LLM: 'llm',
  NCM: 'ncm',
  MEMORY: 'memory',
  AGENT: 'agent',
});

/** Tasks where NCM coarse-to-fine generation may be worth trying (research checkpoints are task-specific). */
const NCM_ELIGIBLE_TASKS = Object.freeze([
  'planning',
  'summarization',
  'draft_outline',
  'parallel_draft',
  'unconditional_sample',
]);

const LLM_DEFAULT_TASKS = Object.freeze([
  'conversation',
  'reasoning',
  'coding',
  'tool_use',
  'intent_extraction',
  'rag',
]);

module.exports = { ENGINES, NCM_ELIGIBLE_TASKS, LLM_DEFAULT_TASKS };