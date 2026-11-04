'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Blocking read-only architecture map — reuse vs extend vs missing.
 * @param {string} repoRoot
 */
function buildArchitectureAudit(repoRoot) {
  const integrations = [
    {
      component: 'SystemObserver',
      path: 'lib/evolution-engine/system-observer.js',
      integrates: ['.runtime/observation/frank.json', 'optional HTTP probes'],
      classification: 'adapter',
    },
    {
      component: 'CapabilityAuditor',
      path: 'lib/evolution-engine/capability-auditor.js',
      integrates: ['lib/execution-fabric/registry-unified.js', 'lib/observation/fix-list.js'],
      classification: 'reuse',
    },
    {
      component: 'PerformanceAnalyzer',
      path: 'lib/evolution-engine/performance-analyzer.js',
      integrates: ['evolution/self-assessment.js'],
      classification: 'reuse',
    },
    {
      component: 'ExecutionCoordinator',
      path: 'lib/evolution-engine/execution-coordinator.js',
      integrates: ['lib/execution-fabric/gateway.js (typed actions)', 'lib/mobile-ops/action-runners.js'],
      classification: 'extend',
    },
    {
      component: 'EvolutionMemory',
      path: 'lib/evolution-engine/evolution-memory.js',
      integrates: ['.runtime/evolution/events.jsonl', 'heidi-core/memory (operator host)'],
      classification: 'extend',
    },
    {
      component: 'Goal cycle (legacy)',
      path: 'evolution/self-evolve-cycle.js',
      integrates: ['Supabase events', 'evolution/heidi-goals.js'],
      classification: 'reuse',
      note: 'Not replaced — scheduled measure/analyze on DB host',
    },
  ];

  let baseSha = null;
  let branch = null;
  let dirty = null;
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 3000 }).trim();
    baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 3000 }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', timeout: 3000 }).trim().length > 0;
  } catch {
    baseSha = null;
  }

  const measurable = {
    cpu_ram: fs.existsSync(path.join(repoRoot, 'lib/evolution-engine/system-observer.js')),
    storage: true,
    service_availability: true,
    api_latency: 'partial — probes when fetch available; else not_measured',
    error_frequency: 'partial — pipeline events when supplied',
    inference_performance: 'not_measured unless host injects',
    memory_retrieval_accuracy: 'not_measured unless runMemoryAudit injected',
    task_success_rates: 'not_measured unless fabric summary wired',
    dependency_security: 'partial — package.json + paid-llm-gate',
  };

  return {
    generated_at: new Date().toISOString(),
    repository: repoRoot,
    branch,
    base_sha: baseSha,
    working_tree_dirty: dirty,
    primary_branch: 'clean-main',
    integrations,
    measurable,
    rule: 'No new orchestrator — evolution runs use EvolutionRunStore + execution-fabric typed actions.',
  };
}

module.exports = { buildArchitectureAudit };
