'use strict';

/**
 * Contract-layer bypass guard (Phase 2).
 *
 * The claim under test: every code path that can execute an action routes
 * through a named governance chokepoint. This test fails if a NEW file
 * appears carrying an action-execution sink without being registered in
 * EXECUTOR_REGISTRY below — i.e. someone adds an executor that bypasses
 * the contract layer.
 *
 * Sinks scanned (real side effects, not reads):
 *   - heidi-core/actions/action-executor.js style: approvedCommands /
 *     approvedScriptDirs / approvedDomains execution
 *   - lib/action-executor.ts dispatch (supabase 'actions' inserts)
 *   - agent_bus status transitions to executing/completed
 *   - outbound side-effect calls (resend API, child_process exec of
 *     non-node commands is covered by the heidi-core executor's own
 *     allowlists — flagged here only in files NOT already registered)
 *
 * If this test fails, either the new file is a legitimate executor (add it
 * to EXECUTOR_REGISTRY with its chokepoint) or it is a bypass (route it
 * through the contract layer instead).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Every file permitted to contain an execution sink, with the chokepoint
 * that governs it. Adding a file here is a governance decision — the PR
 * reviewer must confirm the named chokepoint actually covers the sink.
 */
const EXECUTOR_REGISTRY = {
  // ── lib/ action-executor path (evaluateAction chokepoint) ──────────
  'lib/action-executor.ts': 'ActionChokepoint evaluateAction + action-advisor triple gate (non-R0)',
  'lib/governance/ActionChokepoint.ts': 'IS the chokepoint',
  'lib/action-approval.ts': 'mints signed authorization for ActionChokepoint',
  'lib/agents/base-agent.ts': 'routes through lib/action-executor.ts',
  'lib/orchestrator.ts': 'routes through lib/action-executor.ts',
  'lib/heidi/ExecutionBridgeAdapters.ts': 'adapters into governed systems only',
  'lib/heidi/CognitiveCoreBuilder.ts': 'constructs ActionExecutor — chokepoint inside',
  'lib/heidi/contracts/exercise-safety.ts': 'contract description text only, no execution',
  'lib/heidi-agent.ts': 'constructs lib/action-executor ActionExecutor — chokepoint inside',
  'lib/heidi/DevPatchExecutor.ts': 'dev-patch gate (executor-env-gates)',
  'lib/communication/channels/emailAdapter.ts': 'communication layer, approval-gated upstream',
  'lib/protoforge/auto-gate.js': 'protoforge action gate (protoforge-action-gate)',
  'lib/protoforge/dispatcher.ts': 'protoforge dispatch — gated upstream by auto-gate',

  // ── heidi-core agent_bus / server path ──────────────────────────────
  'heidi-core/actions/action-executor.js': 'own allowlists + action-advisor triple gate (side-effect types)',
  'heidi-core/heidi-agent.js': 'action-advisor triple gate (Phase 2)',
  'heidi-core/server.js': '/act token + isSafe() + mission lifecycle gates',
  'heidi-core/missions/mission-worker.js': 'mission lifecycle approval gates',
  'heidi-core/autonomous-task-queue.js': 'HEIDI_AUTONOMOUS_ACTIONS gate',
  'heidi-core/test-quick.js': 'manual test harness, not a service',
  'evolution/goal-executor.js': 'wraps heidi-core ActionExecutor allowlists',
  'scripts/boot-agent.js': 'process lifecycle management (taskkill), not action execution',

  // ── daemon resolver path ────────────────────────────────────────────
  'lib/heidi/AuthorityBounds.js': 'IS the unattended-authority chokepoint',
  'lib/heidi/CognitiveCore.ts': 'resolveEligibleActions consults AuthorityBounds',
  'lib/heidi/ActionProposals.ts': 'proposal receipts; execution via governed bridge',
  'lib/heidi/MissionRunner.ts': 'mission lifecycle gates',
};

const SINK_PATTERNS = [
  /api\.resend\.com/,                                   // real outbound email
  /\.from\('actions'\)\s*\n?\s*\.insert/,                // action row creation
  /\.from\('agent_bus'\)[\s\S]{0,200}status:\s*'(executing|completed|failed)'/,
  /executeActionAsync/,
  /new ActionExecutor\(/,
  /approvedCommands\.has|approvedScriptDirs|approvedDomains/,
  /child_process'?\)?\s*\.?(exec|execSync|spawn|spawnSync)\(/,
];

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.next-prev', '.next-staging', '.git', 'dist',
  'coverage', '.runtime', 'logs', 'data', 'tmp', 'test-results',
]);
const SCAN_EXT = new Set(['.js', '.ts', '.mjs', '.cjs']);

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(p);
    } else if (SCAN_EXT.has(path.extname(e.name))) {
      yield p;
    }
  }
}

function relPath(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function scanSinks() {
  const hits = {};
  for (const top of ['lib', 'heidi-core', 'scripts', 'apps', 'mcp', 'evolution', 'src']) {
    const abs = path.join(ROOT, top);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relPath(file);
      if (rel.includes('tests/') || rel.includes('__tests__') || rel.includes('.test.')) continue;
      let src;
      try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const matched = SINK_PATTERNS.filter((re) => re.test(src));
      if (matched.length) hits[rel] = matched.map(String);
    }
  }
  return hits;
}

describe('contract-layer executor registry', () => {
  const hits = scanSinks();

  it('no unregistered file contains an action-execution sink', () => {
    const unregistered = Object.keys(hits).filter((f) => !(f in EXECUTOR_REGISTRY));
    expect(unregistered).toEqual([]);
  });

  it('every registered executor file still exists', () => {
    const missing = Object.keys(EXECUTOR_REGISTRY).filter(
      (f) => !fs.existsSync(path.join(ROOT, f)),
    );
    expect(missing).toEqual([]);
  });

  it('the chokepoint itself is registered', () => {
    expect(EXECUTOR_REGISTRY['lib/governance/ActionChokepoint.ts']).toBeDefined();
    expect(EXECUTOR_REGISTRY['lib/heidi/AuthorityBounds.js']).toBeDefined();
  });
});

/**
 * Phase 2.5: registration is not enough — every execution path must
 * actually pass through a named gate. These files MUST contain the gate
 * call; removing the wiring fails this test even though the file stays
 * registered.
 */
const REQUIRED_GATES = {
  'heidi-core/heidi-agent.js': /adviseProposal/,
  'lib/action-executor.ts': /adviseProposal/,
  'heidi-core/actions/action-executor.js': /adviseProposal/,
  'lib/human-actions/detector.js': /adviseProposal/,
  'lib/heidi/CognitiveCore.ts': /adviseProposal/,
};

describe('every execution path is gated, not merely registered', () => {
  for (const [file, pattern] of Object.entries(REQUIRED_GATES)) {
    it(`${file} routes through the triple gate`, () => {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(src).toMatch(pattern);
    });
  }
});
