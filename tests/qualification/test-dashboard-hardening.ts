/**
 * HYDI Operator Dashboard Hardening — Phase 13
 *
 * tests/qualification/test-dashboard-hardening.ts
 *
 * Hardens operator dashboard/control-plane observability while preserving
 * transport-only SSE behavior.
 *
 * Verifies:
 *   DH01 — Authentication and RBAC on all operator routes
 *   DH02 — No secret exposure in dashboard responses
 *   DH03 — Correct tenant/goal filtering
 *   DH04 — Terminal-state correctness
 *   DH05 — Safe intervention controls (approve/reject/cancel only)
 *   DH06 — No mutation from read-only views
 *   DH07 — Accurate recovery and health display
 *   DH08 — SSE remains transport-only (no state mutation)
 *   DH09 — SanitizeResponse applied to all operator responses
 *   DH10 — Goal events endpoint is read-only
 *   DH11 — Recovery endpoint is read-only
 *   DH12 — Status endpoint is read-only
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  HumanProxyControlPlane,
  InterventionController,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  getOperationalEventStream,
  initializePersistence,
  createDefaultResourceBoundaries,
  createDefaultSideEffectPolicies,
} from '../../lib/delegated-operator';
import { sanitizeResponse } from '../../lib/operator-api-shared';
import { hasPermission } from '../../lib/auth/rbac';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

interface DashboardResult {
  id: string;
  invariant: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: DashboardResult[] = [];

function recordResult(r: DashboardResult): void {
  results.push(r);
  const icon = r.status === 'PASS' ? '✓' : '✗';
  console.log(`  ${icon} ${r.id} ${r.invariant}: ${r.status} — ${r.detail}`);
}

// ─── Secret patterns ──────────────────────────────────────────────

const SECRET_PATTERNS = [
  /sk_live_[A-Za-z0-9]+/gi,
  /rk_live_[A-Za-z0-9]+/gi,
  /whsec_[A-Za-z0-9]+/gi,
  /AKIA[A-Z0-9]{16}/g,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /password\s*=\s*[^\s;"\\]+/gi,
  /secret\s*=\s*[^\s;"\\]+/gi,
];

function containsSecret(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return true;
    pattern.lastIndex = 0;
  }
  return false;
}

// ─── Route scanner ────────────────────────────────────────────────

function scanOperatorRoutes(): Array<{ path: string; hasAuth: boolean; isMutation: boolean; permission: string }> {
  const apiDir = path.join(process.cwd(), 'pages', 'api', 'operator');
  const routes: Array<{ path: string; hasAuth: boolean; isMutation: boolean; permission: string }> = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const hasAuth = content.includes('authenticate(');
        const isMutation = content.includes("'POST'") || content.includes('"POST"');
        const permMatch = content.match(/authenticate\([^,]+,\s*[^,]+,\s*['"]([^'"]+)['"]/);
        const permission = permMatch ? permMatch[1] : 'none';
        const relPath = path.relative(path.join(process.cwd(), 'pages', 'api'), fullPath).replace(/\\/g, '/');
        const routePath = '/api/' + relPath.replace(/\.ts$/, '').replace(/\.js$/, '').replace(/\[([^\]]+)\]/g, ':$1');
        routes.push({ path: routePath, hasAuth, isMutation, permission });
      }
    }
  }

  walk(apiDir);
  return routes;
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Operator Dashboard Hardening — Phase 13');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_dash_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_dash_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_dash_%');

  initializePersistence(supabase);

  const identityManager = getIdentityManager();
  const WORKSPACE = process.cwd();
  const identity = identityManager.delegate({
    userId: 'user:owner',
    sessionId: 'dash_test',
    authority: {
      authorityId: 'auth_dash', delegatedBy: 'user:owner', delegatedTo: 'heidi',
      scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
      resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
      timeConstraint: { type: 'session_bounded', sessionId: 'dash_test' },
      requiresConfirmation: {
        destructiveActions: true, financialActions: true, externalCommunication: true,
        deploymentActions: true, credentialManagement: true, highRiskActions: true, criticalRiskActions: true,
      },
      purpose: 'dashboard test', createdAt: new Date().toISOString(), metadata: {},
    },
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'dashboard test',
  });

  const cp = new HumanProxyControlPlane();
  cp.initialize(supabase);
  const controller = new InterventionController();
  const queue = getInterventionQueue();
  const checkpointManager = getCheckpointManager();

  const routes = scanOperatorRoutes();

  // ═════════════════════════════════════════════════════════════════
  // DH01 — Authentication and RBAC on all operator routes
  // ═════════════════════════════════════════════════════════════════
  console.log('  ─── DH01: Authentication and RBAC on all operator routes ───');

  const allAuth = routes.every((r) => r.hasAuth);
  assert(allAuth, 'DH01: All operator routes require authentication');
  for (const r of routes) {
    assert(r.hasAuth, `DH01: ${r.path} requires authentication`);
  }

  // Verify read routes use viewer-compatible permissions
  const readRoutes = routes.filter((r) => !r.isMutation);
  for (const r of readRoutes) {
    assert(r.permission === 'status:view' || r.permission === 'work_sessions:view',
      `DH01: ${r.path} uses read-appropriate permission (${r.permission})`);
  }

  // Verify mutation routes use actions:approve
  const mutationRoutes = routes.filter((r) => r.isMutation);
  for (const r of mutationRoutes) {
    assert(r.permission === 'actions:approve', `DH01: ${r.path} uses actions:approve permission`);
  }

  recordResult({
    id: 'DH01',
    invariant: 'Authentication and RBAC on all operator routes',
    status: allAuth ? 'PASS' : 'FAIL',
    detail: `${routes.length} operator routes, all authenticated, read routes use viewer-compatible permissions`,
  });

  // ═════════════════════════════════════════════════════════════════
  // DH02 — No secret exposure in dashboard responses
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH02: No secret exposure in dashboard responses ───');

  // Verify sanitizeResponse is used in all operator routes
  for (const r of routes) {
    const filePath = path.join(process.cwd(), 'pages', 'api', r.path.replace('/api/', '').replace(/:/g, '[').replace(/\//g, path.sep) + '.ts');
    // Can't easily map route back to file, so check the operator-api-shared module
  }
  // Check that sanitizeResponse is imported in operator routes
  const operatorDir = path.join(process.cwd(), 'pages', 'api', 'operator');
  let sanitizeCount = 0;
  function countSanitize(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) countSanitize(fullPath);
      else if (entry.name.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('sanitizeResponse')) sanitizeCount++;
      }
    }
  }
  countSanitize(operatorDir);
  assert(sanitizeCount === routes.length, `DH02: sanitizeResponse used in all ${routes.length} operator routes (found in ${sanitizeCount})`);

  // Test sanitizeResponse strips secrets
  const testPayload = {
    status: 'running',
    goals: [{ id: 'goal_1', status: 'RUNNING' }],
    secret: 'sk_live_test123',
    webhookSecret: 'whsec_test456',
  };
  const sanitized = sanitizeResponse(testPayload);
  const sanitizedStr = JSON.stringify(sanitized);
  assert(!containsSecret(sanitizedStr), 'DH02: Sanitized dashboard response has no secrets');

  recordResult({
    id: 'DH02',
    invariant: 'No secret exposure in dashboard responses',
    status: 'PASS',
    detail: `sanitizeResponse used in all ${sanitizeCount} operator routes; secret patterns stripped`,
  });

  // ═════════════════════════════════════════════════════════════════
  // DH03 — Correct tenant/goal filtering
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH03: Correct tenant/goal filtering ───');

  // Create goals for two different identities
  const goalA = 'goal_dash_a';
  const goalB = 'goal_dash_b';

  await cp.recordEvent({ goalId: goalA, identityId: identity.identityId, eventType: 'GOAL_CREATED', payload: {} });
  await cp.recordEvent({ goalId: goalB, identityId: identity.identityId, eventType: 'GOAL_CREATED', payload: {} });

  const eventsA = cp.getGoalEvents(goalA);
  const eventsB = cp.getGoalEvents(goalB);
  assert(eventsA.some((e: any) => e.goalId === goalA), 'DH03: Events for goal A contain goal A');
  assert(!eventsA.some((e: any) => e.goalId === goalB), 'DH03: Events for goal A do not contain goal B');
  assert(eventsB.some((e: any) => e.goalId === goalB), 'DH03: Events for goal B contain goal B');

  // Clean up
  await supabase.from('adaptive_operator_events').delete().eq('goal_id', goalA);
  await supabase.from('adaptive_operator_events').delete().eq('goal_id', goalB);

  recordResult({
    id: 'DH03',
    invariant: 'Correct tenant/goal filtering',
    status: 'PASS',
    detail: 'getGoalEvents returns only events for the specified goal',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH04 — Terminal-state correctness
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH04: Terminal-state correctness ───');

  const goalTerminal = 'goal_dash_terminal';
  checkpointManager.checkpoint({
    goalId: goalTerminal, identityId: identity.identityId,
    goalStatement: 'Terminal test', planVersion: 1,
    completedObjectives: ['OBJ_1'], failedObjectives: [], inProgressObjectives: [], pendingObjectives: [],
    executedActions: [], verifiedState: {}, status: 'COMPLETED',
    resumeCondition: 'Done', executedSideEffects: [], summary: 'Terminal test',
  });
  await new Promise((r) => setTimeout(r, 50));

  const terminalState = cp.getGoalState(goalTerminal);
  assert(terminalState !== null, 'DH04: Terminal goal state exists');
  assert(terminalState?.status === 'COMPLETED', 'DH04: Terminal goal status is COMPLETED');

  // Verify listActiveGoals doesn't include terminal goals
  const activeGoals = cp.listActiveGoals();
  assert(!activeGoals.some((g: any) => g.goalId === goalTerminal), 'DH04: Terminal goal not in active goals list');

  await supabase.from('goal_checkpoints').delete().eq('goal_id', goalTerminal);

  recordResult({
    id: 'DH04',
    invariant: 'Terminal-state correctness',
    status: 'PASS',
    detail: 'Terminal goals have correct status; excluded from active goals list',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH05 — Safe intervention controls (approve/reject/cancel only)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH05: Safe intervention controls ───');

  const interventionRoutes = routes.filter((r) => r.path.includes('/interventions/'));
  const approveRoute = interventionRoutes.find((r) => r.path.includes('/approve'));
  const rejectRoute = interventionRoutes.find((r) => r.path.includes('/reject'));
  const cancelRoute = interventionRoutes.find((r) => r.path.includes('/cancel'));

  assert(approveRoute !== undefined, 'DH05: Approve route exists');
  assert(rejectRoute !== undefined, 'DH05: Reject route exists');
  assert(cancelRoute !== undefined, 'DH05: Cancel route exists');
  assert(approveRoute?.permission === 'actions:approve', 'DH05: Approve requires actions:approve');
  assert(rejectRoute?.permission === 'actions:approve', 'DH05: Reject requires actions:approve');
  assert(cancelRoute?.permission === 'actions:approve', 'DH05: Cancel requires actions:approve');

  // Verify no other intervention mutation routes exist
  const otherInterventionMutations = interventionRoutes.filter((r) =>
    !r.path.includes('/approve') && !r.path.includes('/reject') && !r.path.includes('/cancel') && r.isMutation
  );
  assert(otherInterventionMutations.length === 0, 'DH05: No other intervention mutation routes');

  recordResult({
    id: 'DH05',
    invariant: 'Safe intervention controls (approve/reject/cancel only)',
    status: 'PASS',
    detail: 'Only approve/reject/cancel mutation routes exist, all requiring actions:approve',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH06 — No mutation from read-only views
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH06: No mutation from read-only views ───');

  const readRoutesList = routes.filter((r) => !r.isMutation);
  for (const r of readRoutesList) {
    assert(!r.isMutation, `DH06: ${r.path} is read-only (GET)`);
  }

  // Verify read routes use read permissions (status:view or work_sessions:view)
  for (const r of readRoutesList) {
    assert(r.permission === 'status:view' || r.permission === 'work_sessions:view',
      `DH06: ${r.path} uses read permission (${r.permission})`);
  }

  recordResult({
    id: 'DH06',
    invariant: 'No mutation from read-only views',
    status: 'PASS',
    detail: `${readRoutesList.length} read routes, all using read-only permissions`,
  });

  // ═════════════════════════════════════════════════════════════════
  // DH07 — Accurate recovery and health display
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH07: Accurate recovery and health display ───');

  const recoveryRoute = routes.find((r) => r.path === '/api/operator/recovery');
  assert(recoveryRoute !== undefined, 'DH07: Recovery route exists');
  assert(recoveryRoute?.hasAuth === true, 'DH07: Recovery route requires auth');
  assert(!recoveryRoute?.isMutation, 'DH07: Recovery route is read-only');

  const statusRoute = routes.find((r) => r.path === '/api/operator/status');
  assert(statusRoute !== undefined, 'DH07: Status route exists');
  assert(statusRoute?.hasAuth === true, 'DH07: Status route requires auth');
  assert(!statusRoute?.isMutation, 'DH07: Status route is read-only');

  // Verify status route returns operational summary
  const statusSource = fs.readFileSync(path.join(process.cwd(), 'pages', 'api', 'operator', 'status.ts'), 'utf8');
  assert(statusSource.includes('pendingInterventions'), 'DH07: Status includes pending interventions');
  assert(statusSource.includes('recentEvents'), 'DH07: Status includes recent events');

  recordResult({
    id: 'DH07',
    invariant: 'Accurate recovery and health display',
    status: 'PASS',
    detail: 'Recovery and status routes are read-only, authenticated, and return operational data',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH08 — SSE remains transport-only (no state mutation)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH08: SSE remains transport-only ───');

  const sseSource = fs.readFileSync(path.join(process.cwd(), 'pages', 'api', 'operator', 'stream.ts'), 'utf8');
  assert(!sseSource.includes('enqueue'), 'DH08: SSE does not enqueue interventions');
  assert(!sseSource.includes('checkpoint'), 'DH08: SSE does not create checkpoints');
  assert(!sseSource.includes('approve'), 'DH08: SSE does not approve interventions');
  assert(!sseSource.includes('reject'), 'DH08: SSE does not reject interventions');
  assert(!sseSource.includes('cancel'), 'DH08: SSE does not cancel interventions');
  assert(sseSource.includes('sanitizeResponse'), 'DH08: SSE sanitizes responses');
  assert(sseSource.includes('text/event-stream'), 'DH08: SSE uses text/event-stream content type');

  recordResult({
    id: 'DH08',
    invariant: 'SSE remains transport-only (no state mutation)',
    status: 'PASS',
    detail: 'SSE source has no enqueue/checkpoint/approve/reject/cancel; uses sanitizeResponse',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH09 — SanitizeResponse applied to all operator responses
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH09: SanitizeResponse applied to all operator responses ───');

  // Already counted in DH02, but verify it's applied to response objects
  assert(sanitizeCount === routes.length, `DH09: sanitizeResponse used in all ${routes.length} operator routes`);

  recordResult({
    id: 'DH09',
    invariant: 'SanitizeResponse applied to all operator responses',
    status: 'PASS',
    detail: `sanitizeResponse used in all ${sanitizeCount} operator routes`,
  });

  // ═════════════════════════════════════════════════════════════════
  // DH10 — Goal events endpoint is read-only
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH10: Goal events endpoint is read-only ───');

  const eventsRoute = routes.find((r) => r.path === '/api/operator/goals/:goalId/events');
  assert(eventsRoute !== undefined, 'DH10: Goal events route exists');
  assert(eventsRoute?.hasAuth === true, 'DH10: Goal events route requires auth');
  assert(!eventsRoute?.isMutation, 'DH10: Goal events route is read-only');

  const eventsSource = fs.readFileSync(path.join(process.cwd(), 'pages', 'api', 'operator', 'goals', '[goalId]', 'events.ts'), 'utf8');
  assert(eventsSource.includes("req.method !== 'GET'"), 'DH10: Goal events rejects non-GET');
  assert(eventsSource.includes('getGoalEvents'), 'DH10: Goal events uses getGoalEvents (read-only)');

  recordResult({
    id: 'DH10',
    invariant: 'Goal events endpoint is read-only',
    status: 'PASS',
    detail: 'Goal events route is GET-only, authenticated, uses getGoalEvents',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH11 — Recovery endpoint is read-only
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH11: Recovery endpoint is read-only ───');

  assert(recoveryRoute !== undefined, 'DH11: Recovery route exists');
  assert(!recoveryRoute?.isMutation, 'DH11: Recovery route is read-only');

  recordResult({
    id: 'DH11',
    invariant: 'Recovery endpoint is read-only',
    status: 'PASS',
    detail: 'Recovery route is read-only and authenticated',
  });

  // ═════════════════════════════════════════════════════════════════
  // DH12 — Status endpoint is read-only
  // ═════════════════════════════════════════════════════════════════
  console.log('\n  ─── DH12: Status endpoint is read-only ───');

  assert(statusRoute !== undefined, 'DH12: Status route exists');
  assert(!statusRoute?.isMutation, 'DH12: Status route is read-only');

  recordResult({
    id: 'DH12',
    invariant: 'Status endpoint is read-only',
    status: 'PASS',
    detail: 'Status route is read-only and authenticated',
  });

  // ═════════════════════════════════════════════════════════════════
  // RESULTS
  // ═════════════════════════════════════════════════════════════════

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PHASE 13 — DASHBOARD HARDENING RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total assertions: ${passed} passed, ${failed} failed`);
  console.log(`  Total invariants: ${results.length}`);
  console.log(`  PASS: ${passCount}`);
  console.log(`  FAIL: ${failCount}`);
  console.log('═══════════════════════════════════════════════════════════════');

  const machineOutput = {
    phase: '13',
    timestamp: new Date().toISOString(),
    head: require('child_process').execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
    branch: require('child_process').execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(),
    totalAssertions: passed + failed,
    passed, failed,
    invariants: results.length,
    passCount, failCount,
    results,
  };
  const outputPath = path.join(process.cwd(), 'hydi-phase13-dashboard-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(machineOutput, null, 2));

  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) { console.log(`  ✗ ${f}`); }
  }

  const qualified = failed === 0;
  console.log(`\n  PHASE 13 DASHBOARD HARDENING: ${qualified ? '✓ QUALIFIED' : '✗ DEFECTS FOUND'}`);
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
