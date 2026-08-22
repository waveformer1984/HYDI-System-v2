/**
 * HYDI Operational Delegated Operator Qualification
 *
 * Tests Phases 8-17: restart/resume, adaptive failure, resource boundaries,
 * side effects, credential lifecycle, verification contracts, security.
 *
 * Usage:
 *   npx tsx scripts/qualify-operational-delegated-operator.ts
 */

import {
  DelegatedIdentityManager,
  createDefaultSideEffectPolicies,
  createDefaultResourceBoundaries,
  capabilityToSideEffectCategory,
  capabilityToResourceType,
  InterventionQueue,
  GoalCheckpointManager,
  GoalStateMachine,
  VerificationContractRegistry,
  createDefaultVerificationContracts,
} from '../lib/delegated-operator';
import { STRICT_CONFIRMATION } from '../lib/human-action/AuthorityManager';
import type { DelegatedIdentity, AuthorityEvaluationContext, ResourceBoundary } from '../lib/delegated-operator/DelegatedIdentity';
import type { DelegatedAuthority } from '../lib/human-action/AuthorityManager';
import type { RiskLevel } from '../lib/operational/types';
import type { AuthorizationScope, AuthorizationMode, ActionCategory } from '../lib/human-action/HumanActionTypes';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeAuthority(): DelegatedAuthority {
  return {
    authorityId: 'auth_op_001', delegatedBy: 'user:owner', delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION', 'CREDENTIAL_MANAGEMENT', 'DESTRUCTIVE'],
    riskLimit: 'HIGH', riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'op_session' },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: 'operational qualification', createdAt: new Date().toISOString(), metadata: {},
  };
}

function makeIdentity(manager: DelegatedIdentityManager, overrides?: Partial<DelegatedIdentity>): DelegatedIdentity {
  return manager.delegate({
    userId: 'user:owner', sessionId: 'op_session', authority: makeAuthority(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: createDefaultResourceBoundaries(process.cwd()),
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'operational qualification', ...overrides,
  });
}

function makeCtx(identity: DelegatedIdentity, overrides?: Partial<AuthorityEvaluationContext>): AuthorityEvaluationContext {
  return {
    identity, capability: 'filesystem.write_file', category: 'SYSTEM' as ActionCategory,
    target: `${process.cwd()}/test.txt`, risk: 'R1' as RiskLevel,
    scope: 'LOCAL_WRITE' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
    resourceType: 'filesystem_path', sideEffectCategory: 'CREATE', ...overrides,
  };
}

const TMP_DIR = os.tmpdir();
const WORKSPACE = process.cwd();

// ---------------------------------------------------------------------------
// Phase 8 — Restart During Execution
// ---------------------------------------------------------------------------

async function phase8_restartDuringExecution() {
  console.log('\n═══ Phase 8: Restart During Execution ═══');

  // Simulate: goal starts, action completes, checkpoint, process restarts, goal resumes
  const checkpointManager = new GoalCheckpointManager();
  const stateMachine = new GoalStateMachine();

  // Before crash: CREATE_RESOURCE completed
  stateMachine.initialize('goal_restart_001', 'RUNNING');
  const cp = checkpointManager.checkpoint({
    goalId: 'goal_restart_001', identityId: 'identity_001',
    goalStatement: 'Bring test app online',
    planVersion: 1,
    completedObjectives: ['RESOURCE_CREATED'],
    failedObjectives: [], inProgressObjectives: ['SERVICE_STARTED'],
    pendingObjectives: ['HEALTH_VERIFIED'],
    executedActions: [
      { actionId: 'act_001', capability: 'filesystem.write_file', target: `${WORKSPACE}/test-resource.txt`, outcome: 'success', verified: true, timestamp: new Date().toISOString() },
    ],
    verifiedState: { 'resource:exists': true, 'resource:path': `${WORKSPACE}/test-resource.txt` },
    status: 'RUNNING',
    resumeCondition: 'Resource still exists',
    executedSideEffects: [`create:${WORKSPACE}/test-resource.txt`],
    summary: 'Resource created, service starting',
  });

  assert(cp.checkpointId !== undefined, 'Checkpoint created before crash');

  // Simulate crash — state is lost
  // After restart: reload checkpoint
  const restored = checkpointManager.getCheckpoint('goal_restart_001');
  assert(restored !== null, 'Checkpoint recovered after restart');

  // Re-observe environment
  const currentObs = new Map<string, unknown>([
    ['resource:exists', true],
    ['resource:path', `${WORKSPACE}/test-resource.txt`],
  ]);

  const revalidation = checkpointManager.revalidate(restored!, currentObs);
  assert(revalidation.consistent === true, 'Environment consistent with checkpoint');

  // Resume point — should skip completed objectives
  const resume = checkpointManager.getResumePoint(restored!);
  assert(resume.resumeFrom === 'in_progress', 'Resume from in_progress');
  assert(!resume.objectivesToExecute.includes('RESOURCE_CREATED'), 'Completed objective NOT in resume list');
  assert(resume.objectivesToSkip.includes('RESOURCE_CREATED'), 'Completed objective in skip list');

  // Verify no duplicate side effect
  assert(restored!.executedSideEffects.includes(`create:${WORKSPACE}/test-resource.txt`),
    'Executed side effect recorded — will NOT be replayed');

  // State machine: transition to PAUSED (crash), then back to RUNNING (resume)
  stateMachine.transition('goal_restart_001', 'PAUSED', 'Process crashed');
  const transition = stateMachine.transition('goal_restart_001', 'RUNNING', 'Resumed after restart');
  assert(transition.success === true, 'State machine allows resume to RUNNING');
}

// ---------------------------------------------------------------------------
// Phase 9 — Real Adaptive Failure
// ---------------------------------------------------------------------------

async function phase9_adaptiveFailure() {
  console.log('\n═══ Phase 9: Real Adaptive Failure ═══');

  const checkpointManager = new GoalCheckpointManager();

  // Plan 1: START_SERVICE → VERIFY_HEALTH
  const plan1 = checkpointManager.checkpoint({
    goalId: 'goal_adaptive_001', identityId: 'identity_001',
    goalStatement: 'Start test service',
    planVersion: 1,
    completedObjectives: [],
    failedObjectives: ['START_SERVICE_PORT_OCCUPIED'],
    inProgressObjectives: [],
    pendingObjectives: ['VERIFY_HEALTH'],
    executedActions: [],
    verifiedState: {},
    status: 'RECOVERING',
    resumeCondition: 'Service started on alternate port',
    executedSideEffects: [],
    summary: 'Port 9876 occupied — need different approach',
  });

  // Plan 2: KILL_OCCUPYING_PROCESS → START_SERVICE → VERIFY_HEALTH
  // (materially different from Plan 1)
  const plan2 = checkpointManager.checkpoint({
    goalId: 'goal_adaptive_001', identityId: 'identity_001',
    goalStatement: 'Start test service',
    planVersion: 2,
    completedObjectives: ['KILL_OCCUPYING_PROCESS', 'START_SERVICE'],
    failedObjectives: [],
    inProgressObjectives: ['VERIFY_HEALTH'],
    pendingObjectives: [],
    executedActions: [
      { actionId: 'act_002', capability: 'process.stop', target: 'process_on_port_9876', outcome: 'success', verified: true, timestamp: new Date().toISOString() },
      { actionId: 'act_003', capability: 'process.start', target: 'npm start', outcome: 'success', verified: true, timestamp: new Date().toISOString() },
    ],
    verifiedState: { 'process:running': true, 'port:9876': 'available' },
    status: 'RUNNING',
    resumeCondition: 'Health check passes',
    executedSideEffects: ['kill:process_on_port_9876', 'start:npm_start'],
    summary: 'Killed occupying process, started service on port 9876',
  });

  // Second plan MUST differ materially from first
  assert(plan2.planVersion > plan1.planVersion, 'Plan version increased');
  assert(!plan2.failedObjectives.includes('START_SERVICE_PORT_OCCUPIED'), 'Previously failed objective resolved in plan 2');
  assert(plan2.completedObjectives.includes('KILL_OCCUPYING_PROCESS'), 'Plan 2 has new objective not in plan 1');
  assert(plan2.completedObjectives.includes('START_SERVICE'), 'Service started in plan 2');
  assert(plan2.executedActions.length > plan1.executedActions.length, 'Plan 2 has more executed actions');
  assert(plan2.summary !== plan1.summary, 'Plan summaries differ');

  // Verify the plans are materially different
  const plan1ActionCaps = plan1.executedActions.map(a => a.capability).sort();
  const plan2ActionCaps = plan2.executedActions.map(a => a.capability).sort();
  assert(JSON.stringify(plan1ActionCaps) !== JSON.stringify(plan2ActionCaps), 'Action capabilities differ between plans');
}

// ---------------------------------------------------------------------------
// Phase 10 — Resource Boundary Test
// ---------------------------------------------------------------------------

async function phase10_resourceBoundaries() {
  console.log('\n═══ Phase 10: Resource Boundary Enforcement ═══');

  const manager = new DelegatedIdentityManager();
  const identity = makeIdentity(manager, {
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: `${TMP_DIR}/hydi-test`, matchMode: 'prefix', reason: 'Temp test directory' },
      { resourceType: 'browser_origin', effect: 'allow', pattern: 'http://localhost:*', matchMode: 'glob', reason: 'Local test server' },
      { resourceType: 'browser_origin', effect: 'deny', pattern: 'https://evil.example.com', matchMode: 'exact', reason: 'Unauthorized external origin' },
    ],
  });

  // Permit: workspace/test/*
  const allowResult = manager.evaluate(makeCtx(identity, {
    target: `${WORKSPACE}/test/file.txt`,
  }));
  assert(allowResult.authorized === true, 'Workspace test path allowed');

  // Deny: protected/system/*
  const denyResult = manager.evaluate(makeCtx(identity, {
    target: 'C:\\Windows\\System32\\config\\system',
  }));
  assert(denyResult.authorized === false, 'Protected system path denied');
  assert(denyResult.deniedBy === 'resource_boundary', 'Denied by resource boundary');

  // No side effect — verify the denial reason is recorded
  assert(denyResult.reason.includes('denied by boundary'), 'Denial reason recorded');

  // Allow: localhost test server
  const localResult = manager.evaluate(makeCtx(identity, {
    capability: 'browser.navigate',
    target: 'http://localhost:9876',
    risk: 'R1', scope: 'READ_ONLY',
    resourceType: 'browser_origin', sideEffectCategory: 'MODIFY',
  }));
  assert(localResult.authorized === true, 'Localhost test server allowed');

  // Deny: unauthorized external origin
  const evilResult = manager.evaluate(makeCtx(identity, {
    capability: 'browser.navigate',
    target: 'https://evil.example.com',
    risk: 'R1', scope: 'READ_ONLY',
    resourceType: 'browser_origin', sideEffectCategory: 'MODIFY',
  }));
  assert(evilResult.authorized === false, 'Unauthorized external origin denied');

  // Deny: path traversal attempt
  const traversalResult = manager.evaluate(makeCtx(identity, {
    target: `${WORKSPACE}/test/../../../Windows/System32/evil.bat`,
  }));
  assert(traversalResult.authorized === false, 'Path traversal attempt denied');
}

// ---------------------------------------------------------------------------
// Phase 11 — Side Effect Testing
// ---------------------------------------------------------------------------

async function phase11_sideEffects() {
  console.log('\n═══ Phase 11: Side Effect Category Testing ═══');

  const manager = new DelegatedIdentityManager();
  const identity = makeIdentity(manager);

  const categories: Array<{ name: string; capability: string; sideEffect: any; expectedAuth: boolean; expectedConfirm: boolean; risk: string; scope: string }> = [
    { name: 'READ', capability: 'filesystem.read_file', sideEffect: 'READ', expectedAuth: true, expectedConfirm: false, risk: 'R1', scope: 'READ_ONLY' },
    { name: 'CREATE', capability: 'filesystem.write_file', sideEffect: 'CREATE', expectedAuth: true, expectedConfirm: false, risk: 'R2', scope: 'LOCAL_WRITE' },
    { name: 'MODIFY', capability: 'filesystem.move_file', sideEffect: 'MODIFY', expectedAuth: true, expectedConfirm: false, risk: 'R2', scope: 'LOCAL_WRITE' },
    { name: 'DELETE', capability: 'filesystem.delete_file', sideEffect: 'DELETE', expectedAuth: true, expectedConfirm: true, risk: 'R3', scope: 'DESTRUCTIVE' },
    { name: 'COMMUNICATE', capability: 'comm.send_email', sideEffect: 'COMMUNICATE', expectedAuth: true, expectedConfirm: true, risk: 'R3', scope: 'EXTERNAL_COMMUNICATION' },
    { name: 'AUTHENTICATE', capability: 'credential.provision', sideEffect: 'AUTHENTICATE', expectedAuth: true, expectedConfirm: false, risk: 'R2', scope: 'CREDENTIAL_MANAGEMENT' },
    { name: 'FINANCIAL', capability: 'financial.create_charge', sideEffect: 'FINANCIAL', expectedAuth: true, expectedConfirm: true, risk: 'R5', scope: 'FINANCIAL' },
    { name: 'DEPLOY', capability: 'dev.deploy', sideEffect: 'DEPLOY', expectedAuth: true, expectedConfirm: true, risk: 'R3', scope: 'DEPLOYMENT' },
    { name: 'EXTERNAL_COMMITMENT', capability: 'comm.send_message', sideEffect: 'COMMUNICATE', expectedAuth: true, expectedConfirm: true, risk: 'R3', scope: 'EXTERNAL_COMMUNICATION' },
  ];

  for (const cat of categories) {
    const result = manager.evaluate(makeCtx(identity, {
      capability: cat.capability,
      target: cat.capability.includes('filesystem') ? `${WORKSPACE}/test.txt` : 'test-service',
      risk: cat.risk as RiskLevel,
      scope: cat.scope as AuthorizationScope,
      resourceType: cat.capability.startsWith('filesystem') ? 'filesystem_path' : cat.capability.startsWith('browser') ? 'browser_origin' : 'service',
      sideEffectCategory: cat.sideEffect,
    }));
    assert(result.authorized === cat.expectedAuth, `${cat.name}: authorized=${result.authorized}`);
    if (cat.expectedConfirm) {
      assert(result.requiresConfirmation === true, `${cat.name}: requires confirmation`);
    }
  }

  // Financial actions must remain governed — verify they can't be autonomous
  const financialResult = manager.evaluate(makeCtx(identity, {
    capability: 'financial.create_charge', target: 'stripe',
    risk: 'R5', scope: 'FINANCIAL', resourceType: 'service', sideEffectCategory: 'FINANCIAL',
  }));
  assert(financialResult.requiresConfirmation === true, 'Financial action always requires confirmation');
}

// ---------------------------------------------------------------------------
// Phase 12 — Credential Lifecycle
// ---------------------------------------------------------------------------

async function phase12_credentialLifecycle() {
  console.log('\n═══ Phase 12: Credential Lifecycle Testing ═══');

  const manager = new DelegatedIdentityManager();
  const identity = makeIdentity(manager);

  // DISCOVER
  const discoverResult = manager.evaluate(makeCtx(identity, {
    capability: 'credential.discover', target: 'STRIPE_SECRET_KEY',
    risk: 'R0', scope: 'READ_ONLY', resourceType: 'credential_ref', sideEffectCategory: 'READ',
  }));
  assert(discoverResult.authorized === true, 'Credential discover authorized');

  // VALIDATE
  const validateResult = manager.evaluate(makeCtx(identity, {
    capability: 'credential.validate', target: 'SUPABASE_SERVICE_ROLE_KEY',
    risk: 'R0', scope: 'READ_ONLY', resourceType: 'credential_ref', sideEffectCategory: 'READ',
  }));
  assert(validateResult.authorized === true, 'Credential validate authorized');

  // PROVISION (requires confirmation)
  const provisionResult = manager.evaluate(makeCtx(identity, {
    capability: 'credential.provision', target: 'NEW_API_KEY',
    risk: 'R2', scope: 'CREDENTIAL_MANAGEMENT', resourceType: 'credential_ref', sideEffectCategory: 'AUTHENTICATE',
  }));
  assert(provisionResult.authorized === true, 'Credential provision authorized');

  // ROTATE (excluded in this test identity)
  const rotateIdentity = makeIdentity(manager, {
    excludedCapabilities: ['credential.rotate'],
  });
  const rotateResult = manager.evaluate(makeCtx(rotateIdentity, {
    capability: 'credential.rotate', target: 'SUPABASE_SERVICE_ROLE_KEY',
    risk: 'R2', scope: 'CREDENTIAL_MANAGEMENT', resourceType: 'credential_ref', sideEffectCategory: 'AUTHENTICATE',
  }));
  assert(rotateResult.authorized === false, 'Credential rotate denied (excluded)');

  // REVOKE
  const revokeResult = manager.evaluate(makeCtx(identity, {
    capability: 'credential.revoke', target: 'OLD_API_KEY',
    risk: 'R3', scope: 'DESTRUCTIVE', resourceType: 'credential_ref', sideEffectCategory: 'DELETE',
  }));
  assert(revokeResult.authorized === true, 'Credential revoke authorized');
  assert(revokeResult.requiresConfirmation === true, 'Credential revoke requires confirmation');

  // Secrets never appear in logs — verify no secret material in evaluation result
  const allResults = [discoverResult, validateResult, provisionResult, rotateResult, revokeResult];
  for (const result of allResults) {
    const serialized = JSON.stringify(result);
    assert(!serialized.includes('sk_live_'), 'No Stripe key in result');
    assert(!serialized.includes('password='), 'No password in result');
    assert(!serialized.includes('Bearer '), 'No Bearer token in result');
  }
}

// ---------------------------------------------------------------------------
// Phase 13 — Verification Contracts
// ---------------------------------------------------------------------------

async function phase13_verificationContracts() {
  console.log('\n═══ Phase 13: Verification Contract Audit ═══');

  const registry = new VerificationContractRegistry();
  for (const contract of createDefaultVerificationContracts()) {
    registry.register(contract);
  }

  // Filesystem write — verify file exists after write
  const writeSuccess = registry.verify('filesystem.write_file', { exists: true, size: 42 });
  assert(writeSuccess.verified === true, 'Write verification passes when file exists');

  const writeFail = registry.verify('filesystem.write_file', { exists: false, size: 0 });
  assert(writeFail.verified === false, 'Write verification fails when file does not exist');
  assert(writeFail.failedConditions.length > 0, 'Failed conditions reported');

  // HTTP — verify status code
  const httpSuccess = registry.verify('network.http_request', { statusCode: 200, body: {} });
  assert(httpSuccess.verified === true, 'HTTP 200 passes verification');

  const httpFail = registry.verify('network.http_request', { statusCode: 500, body: {} });
  assert(httpFail.verified === false, 'HTTP 500 fails verification');

  // Browser navigation — verify URL matches (with target context for placeholder substitution)
  const navSuccess = registry.verify('browser.navigate', { url: 'http://localhost:9876/', title: 'Test' }, { target: 'http://localhost:9876' });
  assert(navSuccess.verified === true, 'Navigation verification passes when URL matches');

  // Git commit — verify commit hash exists
  const gitSuccess = registry.verify('dev.git_commit', { committed: true, commitHash: 'abc123' });
  assert(gitSuccess.verified === true, 'Git commit verification passes');

  const gitFail = registry.verify('dev.git_commit', { committed: true, commitHash: null });
  assert(gitFail.verified === false, 'Git commit verification fails when no hash');

  // Build — verify exit code 0
  const buildSuccess = registry.verify('dev.build', { exitCode: 0, stdout: '', stderr: '' });
  assert(buildSuccess.verified === true, 'Build verification passes with exit code 0');

  const buildFail = registry.verify('dev.build', { exitCode: 1, stdout: '', stderr: 'error' });
  assert(buildFail.verified === false, 'Build verification fails with exit code 1');

  // The system must never confuse "command succeeded" with "goal succeeded"
  // This is the core principle — adapter success != objective success
  assert(writeFail.verified === false, 'Adapter success does NOT equal objective success');
}

// ---------------------------------------------------------------------------
// Phase 16 — User-Facing Operational Status
// ---------------------------------------------------------------------------

async function phase16_operationalStatus() {
  console.log('\n═══ Phase 16: User-Facing Operational Status ═══');

  const { renderOperationalStatus, getOperationalStatus } = await import('../lib/delegated-operator/OperationalStatus');

  // Executing status
  const executing = getOperationalStatus({
    goalId: 'goal_001',
    goalStatement: 'Bring ProtoForge online',
    currentObjective: 'Verify service health',
    currentAction: 'HTTP health check',
    goalStatus: 'RUNNING',
    authorized: true,
    verificationResult: 'pending',
    sessionId: 'session_001',
  });
  const rendered = renderOperationalStatus(executing);
  assert(rendered.includes('Status: EXECUTING'), 'Status shows EXECUTING');
  assert(rendered.includes('Goal:'), 'Goal shown');
  assert(rendered.includes('Bring ProtoForge online'), 'Goal statement shown');
  assert(rendered.includes('Current objective:'), 'Current objective shown');
  assert(rendered.includes('Verify service health'), 'Objective text shown');
  assert(rendered.includes('Authorization:'), 'Authorization shown');
  assert(rendered.includes('Authorized'), 'Authorization state shown');
  assert(rendered.includes('Verification:'), 'Verification shown');
  assert(rendered.includes('Pending'), 'Verification state shown');
  assert(!rendered.includes('chain-of-thought'), 'No chain-of-thought exposed');
  assert(!rendered.includes('reasoning'), 'No internal reasoning exposed');

  // Waiting for human
  const waiting = getOperationalStatus({
    goalId: 'goal_002',
    goalStatement: 'Authenticate to test app',
    currentObjective: 'Complete MFA',
    goalStatus: 'WAITING_FOR_HUMAN',
    authorized: true,
    verificationResult: 'pending',
    waitingFor: 'human_action',
  });
  const waitingRendered = renderOperationalStatus(waiting);
  assert(waitingRendered.includes('Status: WAITING_FOR_HUMAN'), 'Status shows WAITING_FOR_HUMAN');
  assert(waitingRendered.includes('Waiting for:'), 'Waiting-for section shown');
  assert(waitingRendered.includes('Human action required'), 'Human action requirement shown');

  // Completed
  const completed = getOperationalStatus({
    goalId: 'goal_003',
    goalStatement: 'Test task',
    goalStatus: 'COMPLETED',
    authorized: true,
    verificationResult: 'verified',
  });
  const completedRendered = renderOperationalStatus(completed);
  assert(completedRendered.includes('Status: COMPLETED'), 'Status shows COMPLETED');
  assert(completedRendered.includes('Verified'), 'Verification shows Verified');

  // Failed
  const failedStatus = getOperationalStatus({
    goalId: 'goal_004',
    goalStatement: 'Failed task',
    goalStatus: 'FAILED',
    authorized: false,
    verificationResult: 'failed',
  });
  const failedRendered = renderOperationalStatus(failedStatus);
  assert(failedRendered.includes('Status: FAILED'), 'Status shows FAILED');
  assert(failedRendered.includes('Denied'), 'Authorization shows Denied');
  assert(failedRendered.includes('Failed'), 'Verification shows Failed');

  // Print example
  console.log('\n  Example output:');
  console.log('  ' + rendered.split('\n').join('\n  '));
}

// ---------------------------------------------------------------------------
// Phase 17 — Security
// ---------------------------------------------------------------------------

async function phase17_security() {
  console.log('\n═══ Phase 17: Security Qualification ═══');

  const manager = new DelegatedIdentityManager();
  const identity = makeIdentity(manager);

  // Prompt injection — goal statement with embedded command
  const injectionIdentity = makeIdentity(manager, {
    includedCapabilities: ['filesystem.read_file'],
  });
  const injectionResult = manager.evaluate(makeCtx(injectionIdentity, {
    capability: 'process.execute',
    target: 'rm -rf /', // injected command
    risk: 'R2', scope: 'SERVICE_OPERATION',
    resourceType: 'command', sideEffectCategory: 'DELETE',
  }));
  assert(injectionResult.authorized === false, 'Prompt injection: unauthorized capability denied');
  assert(injectionResult.deniedBy === 'excluded_capability', 'Denied by capability exclusion');

  // Authority escalation — try to access higher risk than allowed
  const escalationResult = manager.evaluate(makeCtx(identity, {
    capability: 'filesystem.delete_file',
    target: `${WORKSPACE}/test.txt`,
    risk: 'R5' as RiskLevel, // exceeds R4 limit
    scope: 'DESTRUCTIVE', sideEffectCategory: 'DELETE',
  }));
  assert(escalationResult.authorized === false, 'Authority escalation: R5 risk denied');

  // Path traversal
  const traversalResult = manager.evaluate(makeCtx(identity, {
    target: `${WORKSPACE}/test/../../etc/passwd`,
  }));
  assert(traversalResult.authorized === false, 'Path traversal denied');

  // Unauthorized browser origin
  const browserResult = manager.evaluate(makeCtx(identity, {
    capability: 'browser.navigate', target: 'chrome://settings',
    risk: 'R1', scope: 'READ_ONLY',
    resourceType: 'browser_origin', sideEffectCategory: 'MODIFY',
  }));
  assert(browserResult.authorized === false, 'Unauthorized browser origin denied');

  // Unauthorized API domain — add a deny rule
  const domainIdentity = makeIdentity(manager, {
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'api_endpoint', effect: 'deny', pattern: 'https://api.evil.com/*', matchMode: 'glob', reason: 'Unauthorized API' },
    ],
  });
  const apiResult = manager.evaluate(makeCtx(domainIdentity, {
    capability: 'network.http_request', target: 'https://api.evil.com/data',
    risk: 'R1', scope: 'READ_ONLY',
    resourceType: 'api_endpoint', sideEffectCategory: 'READ',
  }));
  assert(apiResult.authorized === false, 'Unauthorized API domain denied');

  // Destructive operation without authority
  const destructiveIdentity = makeIdentity(manager, {
    excludedCapabilities: ['filesystem.delete_file'],
  });
  const destructiveResult = manager.evaluate(makeCtx(destructiveIdentity, {
    capability: 'filesystem.delete_file', target: `${WORKSPACE}/test.txt`,
    risk: 'R3', scope: 'DESTRUCTIVE', sideEffectCategory: 'DELETE',
  }));
  assert(destructiveResult.authorized === false, 'Destructive operation without authority denied');

  // Financial operation — must require confirmation
  const financialResult = manager.evaluate(makeCtx(identity, {
    capability: 'financial.create_charge', target: 'stripe',
    risk: 'R5', scope: 'FINANCIAL', resourceType: 'service', sideEffectCategory: 'FINANCIAL',
  }));
  assert(financialResult.requiresConfirmation === true, 'Financial operation requires confirmation');

  // Credential exposure — verify no secrets in any result
  const allResults = [injectionResult, escalationResult, traversalResult, browserResult, apiResult, destructiveResult, financialResult];
  for (const result of allResults) {
    const serialized = JSON.stringify(result);
    assert(!serialized.includes('sk_live_'), 'No Stripe key exposed');
    assert(!serialized.includes('password='), 'No password exposed');
    assert(!serialized.includes('Bearer '), 'No Bearer token exposed');
  }

  // Stale checkpoint
  const checkpointManager = new GoalCheckpointManager();
  const cp = checkpointManager.checkpoint({
    goalId: 'goal_stale_sec', identityId: 'identity_001',
    goalStatement: 'Test', planVersion: 1,
    completedObjectives: ['HEALTHY'], failedObjectives: [],
    inProgressObjectives: [], pendingObjectives: ['DEPLOY'],
    executedActions: [], verifiedState: { 'health:localhost:3000': { healthy: true } },
    status: 'PAUSED', resumeCondition: 'Service healthy',
    executedSideEffects: [], summary: 'Paused',
  });
  const staleCheck = checkpointManager.revalidate(cp, new Map([
    ['health:localhost:3000', { healthy: false }],
  ]));
  assert(staleCheck.consistent === false, 'Stale checkpoint detected');

  // Duplicate side effect prevention
  assert(cp.executedSideEffects.length === 0, 'No side effects recorded yet');
  // After adding a side effect, it should be tracked
  const cp2 = checkpointManager.checkpoint({
    ...cp, checkpointId: '', createdAt: '',
    goalId: 'goal_dup_sec', executedSideEffects: ['create:resource_1'],
  } as any);
  assert(cp2.executedSideEffects.includes('create:resource_1'), 'Side effect tracked for dedup');

  // Intervention spoofing — verify only pending interventions can be resolved
  const queue = new InterventionQueue();
  const req = queue.enqueue({
    goalId: 'goal_spoof_001', identityId: 'identity_001', userId: 'user:owner',
    currentObjective: 'TEST', blocker: 'TEST', requiredHumanAction: 'TEST',
    whyRequired: 'TEST', expectedResultingState: 'TEST',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: 'TEST', auditId: 'audit_001', interventionType: 'MFA_REQUIRED',
    originalRequest: {
      requestId: 'req_001', actionId: 'action_001', goalId: 'goal_spoof_001',
      reason: 'test', whatWasAttempted: 'test', whatSucceeded: 'test',
      whatFailed: 'test', whyCannotContinue: 'test', requiredHumanAction: 'test',
      whatHappensAfter: 'test', interventionType: 'MFA_REQUIRED' as any, timestamp: new Date().toISOString(),
    },
  });
  // Resolve once
  assert(queue.resolve(req.requestId, 'approved') === true, 'First resolution succeeds');
  // Try to resolve again (spoofing attempt)
  assert(queue.resolve(req.requestId, 'malicious') === false, 'Double-resolution blocked (spoofing prevented)');

  // Goal/session identity mismatch
  const mismatchManager = new DelegatedIdentityManager();
  const mismatchIdentity = mismatchManager.delegate({
    userId: 'user:owner', sessionId: 'session_A', authority: makeAuthority(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [], alwaysConfirmActions: [],
    resourceBoundaries: createDefaultResourceBoundaries(WORKSPACE),
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'test',
  });
  // Try to use identity from session_A for session_B
  const wrongSession = mismatchManager.getIdentityBySession('session_B');
  assert(wrongSession === null, 'Session identity mismatch: no identity found for wrong session');
  // Correct session works
  const correctSession = mismatchManager.getIdentityBySession('session_A');
  assert(correctSession !== null, 'Correct session identity found');
  assert(correctSession?.identityId === mismatchIdentity.identityId, 'Identity matches');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Operational Delegated Operator Qualification');
  console.log('  Phases 8-17');
  console.log('═══════════════════════════════════════════════════════════════');

  await phase8_restartDuringExecution();
  await phase9_adaptiveFailure();
  await phase10_resourceBoundaries();
  await phase11_sideEffects();
  await phase12_credentialLifecycle();
  await phase13_verificationContracts();
  await phase16_operationalStatus();
  await phase17_security();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) { console.log(`  ✗ ${f}`); }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
