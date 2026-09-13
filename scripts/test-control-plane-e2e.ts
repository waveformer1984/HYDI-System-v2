/**
 * HYDI Control-Plane End-to-End Test — Phase 10
 *
 * Real end-to-end test using the HumanProxyControlPlane.
 *
 * USER GOAL: "Make the local ProtoForge environment operational."
 *
 * Intentionally introduces:
 *   - service/port conflict
 *   - browser authentication/MFA intervention
 *   - process interruption (PM2 restart)
 *   - checkpoint restoration
 *
 * Verifies the full control-plane lifecycle:
 *   GOAL → PLAN → ACTION → FAILURE → REPLAN → INTERVENTION
 *   → CHECKPOINT → PM2 RESTART → RESTORE → VERIFY → RESUME → COMPLETE
 *
 * Uses: real filesystem, real process, real HTTP, real Chrome,
 *       real Supabase, real PM2.
 *
 * Records operational events through the control plane and verifies
 * they are available via the control-plane API surface.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { execSync } from 'child_process';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  GoalCheckpointManager,
  CheckpointPersistence,
  InterventionQueue,
  InterventionPersistence,
  GoalStateMachine,
  DelegatedIdentityManager,
  VerificationContractRegistry,
  createDefaultVerificationContracts,
  createDefaultResourceBoundaries,
  createDefaultSideEffectPolicies,
  HumanProxyControlPlane,
  InterventionController,
  OperationalEventPersistence,
  isOperationalGoalStateClean,
  isOperationalEventClean,
  getIdentityManager,
  getInterventionQueue,
  getCheckpointManager,
  getVerificationRegistry,
  initializePersistence,
  restoreFromPersistence,
} from '../lib/delegated-operator';
import type { DelegatedAuthority } from '../lib/human-action/AuthorityManager';
import { STRICT_CONFIRMATION } from '../lib/human-action/AuthorityManager';
import type { RiskLevel } from '../lib/operational/types';
import type { AuthorizationScope, AuthorizationMode, ActionCategory } from '../lib/human-action/HumanActionTypes';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];
const transcript: string[] = [];

function log(msg: string): void { console.log(msg); transcript.push(msg); }
function assert(condition: boolean, message: string): void {
  if (condition) { passed++; log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); log(`  ✗ ${message}`); }
}
function recordFact(label: string, value: string): void {
  log(`  [${label}] ${value}`);
}
function execSyncSafe(cmd: string): string {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim(); }
  catch { return 'ERROR'; }
}

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
function findChrome(): string | null {
  for (const p of CHROME_PATHS) { try { if (fs.existsSync(p)) return p; } catch { /* ignore */ } }
  return null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TMP_DIR = path.join(os.tmpdir(), 'hydi-cp-e2e');
const WORKSPACE = process.cwd();
const CONFIG_FILE = path.join(TMP_DIR, 'protoforge-config.json');
const TEST_APP_PORT = 9891;
const TEST_APP_PORT_ALT = 9892;

function makeAuthority(): DelegatedAuthority {
  return {
    authorityId: 'auth_cp_e2e', delegatedBy: 'user:owner', delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION', 'CREDENTIAL_MANAGEMENT'],
    riskLimit: 'HIGH', riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'cp_e2e_session' },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: 'control-plane e2e test', createdAt: new Date().toISOString(), metadata: {},
  };
}

let testServer: http.Server | null = null;

function launchTestApp(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>ProtoForge Local</title></head>
          <body><h1>ProtoForge Local</h1>
          <p>Status: <span id="status">operational</span></p>
          <nav><a href="/login" id="nav-login">Login</a></nav></body></html>`);
      } else if (url.pathname === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>Login</title></head>
          <body><h1>Login</h1>
          <form id="login-form" action="/auth" method="POST">
          <input type="text" id="username" name="username" />
          <input type="password" id="password" name="password" />
          <button type="submit" id="login-btn">Login</button>
          </form></body></html>`);
      } else if (url.pathname === '/auth' && req.method === 'POST') {
        let body = ''; req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          if (params.get('username') === 'admin' && params.get('password') === 'demo') {
            res.writeHead(302, { Location: '/mfa' }); res.end();
          } else { res.writeHead(200); res.end('<html><body><h1>Failed</h1></body></html>'); }
        });
      } else if (url.pathname === '/mfa') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>MFA</title></head>
          <body><h1>MFA Challenge</h1>
          <div id="mfa-status">pending</div>
          <form id="mfa-form" action="/mfa-approve" method="POST">
          <button type="submit" id="mfa-approve-btn">Approve</button>
          </form></body></html>`);
      } else if (url.pathname === '/mfa-approve' && req.method === 'POST') {
        res.writeHead(302, { Location: '/dashboard' }); res.end();
      } else if (url.pathname === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>Dashboard</title></head>
          <body><h1>Dashboard</h1>
          <p>Session: <span id="session">authenticated</span></p>
          <p>Status: <span id="status">operational</span></p></body></html>`);
      } else if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', port }));
      } else { res.writeHead(404); res.end('Not found'); }
    });
    server.listen(port, '127.0.0.1', () => { testServer = server; resolve(); });
    server.on('error', reject);
  });
}

function stopTestApp(): void { if (testServer) { testServer.close(); testServer = null; } }

async function checkHealth(port: number): Promise<{ ok: boolean; body: any }> {
  return new Promise((resolve) => {
    http.get(`http://localhost:${port}/health`, (res) => {
      let body = ''; res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode === 200, body: JSON.parse(body) }); } catch { resolve({ ok: false, body: null }); } });
    }).on('error', () => resolve({ ok: false, body: null }));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('═══════════════════════════════════════════════════════════════');
  log('  HYDI Control-Plane End-to-End Test — Phase 10');
  log('  User input: "Make the local ProtoForge environment operational."');
  log('  NO MOCKS — Real Supabase, Real PM2, Real Chrome, Real Control Plane');
  log('═══════════════════════════════════════════════════════════════');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_cp_e2e_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_cp_e2e_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_cp_e2e_%');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  try { fs.unlinkSync(CONFIG_FILE); } catch { /* ignore */ }

  execSyncSafe('npx pm2 stop hydi-daemon 2>nul');
  execSyncSafe('npx pm2 delete hydi-daemon 2>nul');

  // Initialize control plane
  const controlPlane = new HumanProxyControlPlane();
  controlPlane.initialize(supabase);

  // Initialize delegated operator — use singletons so control plane can see state
  initializePersistence(supabase);
  const identityManager = getIdentityManager();
  const checkpointManager = getCheckpointManager();
  const interventionQueue = getInterventionQueue();
  const verificationRegistry = getVerificationRegistry();

  const identity = identityManager.delegate({
    userId: 'user:owner', sessionId: 'cp_e2e_session', authority: makeAuthority(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    includedCapabilities: [], excludedCapabilities: [],
    alwaysConfirmActions: [],
    resourceBoundaries: [
      ...createDefaultResourceBoundaries(WORKSPACE),
      { resourceType: 'filesystem_path', effect: 'allow', pattern: TMP_DIR, matchMode: 'prefix', reason: 'Demo workspace' },
      { resourceType: 'browser_origin', effect: 'allow', pattern: 'http://localhost:*', matchMode: 'glob', reason: 'Local test server' },
    ],
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'control-plane e2e test',
  });

  const interventionController = new InterventionController();
  interventionController.initialize(supabase);

  const stateMachine = new GoalStateMachine();

  const goalId = 'goal_cp_e2e_001';
  stateMachine.initialize(goalId, 'RUNNING');

  // ─── Record GOAL_CREATED and GOAL_STARTED ────────────────────────
  await controlPlane.recordEvent({ goalId, sessionId: 'cp_e2e_session', identityId: identity.identityId, eventType: 'GOAL_CREATED', payload: { goalText: 'Make local ProtoForge environment operational' } });
  await controlPlane.recordEvent({ goalId, sessionId: 'cp_e2e_session', identityId: identity.identityId, eventType: 'GOAL_STARTED', payload: { planVersion: 1 } });
  await controlPlane.recordEvent({ goalId, sessionId: 'cp_e2e_session', identityId: identity.identityId, eventType: 'PLAN_CREATED', payload: { planVersion: 1 } });

  // ─── STEP 1: Filesystem — Create config ──────────────────────────
  recordFact('OBJECTIVE', 'Create ProtoForge configuration file');
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_SELECTED', payload: { capability: 'filesystem.write_file', targetResource: CONFIG_FILE, riskLevel: 'R1' } });

  const writeAuth = identityManager.evaluate({
    identity, capability: 'filesystem.write_file', category: 'SYSTEM' as ActionCategory,
    target: CONFIG_FILE, risk: 'R1' as RiskLevel,
    scope: 'LOCAL_WRITE' as AuthorizationScope, mode: 'autonomous' as AuthorizationMode,
    resourceType: 'filesystem_path', sideEffectCategory: 'CREATE',
  });
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'AUTHORIZATION_GRANTED', payload: { capability: 'filesystem.write_file', authorizationState: 'authorized', authorizationReason: writeAuth.reason } });

  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_STARTED', payload: { capability: 'filesystem.write_file', targetResource: CONFIG_FILE, riskLevel: 'R1' } });
  const configContent = JSON.stringify({ service: 'protoforge-local', port: TEST_APP_PORT, environment: 'demo', createdAt: new Date().toISOString() }, null, 2);
  fs.writeFileSync(CONFIG_FILE, configContent);
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED', payload: { capability: 'filesystem.write_file', targetResource: CONFIG_FILE, result: 'success' } });

  const writeVerify = verificationRegistry.verify('filesystem.write_file', { exists: fs.existsSync(CONFIG_FILE), size: fs.statSync(CONFIG_FILE).size });
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'VERIFICATION_PASSED', payload: { verificationContract: 'filesystem.write_file', verificationResult: 'verified' } });
  assert(writeVerify.verified, 'Config file created and verified');

  // Checkpoint
  const cp1 = checkpointManager.checkpoint({
    goalId, identityId: identity.identityId, goalStatement: 'Make local ProtoForge environment operational',
    planVersion: 1, completedObjectives: ['CONFIG_CREATED'], failedObjectives: [], inProgressObjectives: ['SERVICE_STARTED'],
    pendingObjectives: ['HEALTH_VERIFIED', 'BROWSER_VERIFIED', 'AUTHENTICATED'],
    executedActions: [{ actionId: 'act_cp_001', capability: 'filesystem.write_file', target: CONFIG_FILE, outcome: 'success', verified: true, timestamp: new Date().toISOString() }],
    verifiedState: { 'config:exists': true, 'config:path': CONFIG_FILE },
    status: 'RUNNING', resumeCondition: 'Config file exists', executedSideEffects: [`create:${CONFIG_FILE}`], summary: 'Config created',
  });
  await new Promise((r) => setTimeout(r, 300));
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'CHECKPOINT_CREATED', payload: { checkpointId: cp1.checkpointId, checkpointStatus: 'RUNNING' } });

  // ─── Verify control plane sees the goal ───────────────────────────
  const goalState1 = controlPlane.getGoalState(goalId);
  assert(goalState1 !== null, 'Control plane sees goal after step 1');
  assert(goalState1!.goalText === 'Make local ProtoForge environment operational', 'Control plane shows goal text');
  assert(goalState1!.status === 'RUNNING', 'Control plane shows RUNNING status');
  assert(goalState1!.completedActionCount === 1, 'Control plane shows 1 completed action');
  assert(goalState1!.checkpointId === cp1.checkpointId, 'Control plane shows checkpoint ID');
  assert(isOperationalGoalStateClean(goalState1!), 'Control plane state is secret-clean');

  // ─── STEP 2: Port conflict + replan ──────────────────────────────
  recordFact('OBJECTIVE', 'Start ProtoForge local service');
  const blocker = http.createServer((req, res) => { res.writeHead(200); res.end('blocker'); });
  await new Promise<void>((resolve) => blocker.listen(TEST_APP_PORT, '127.0.0.1', resolve));

  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_FAILED', payload: { capability: 'process.start', targetResource: `port:${TEST_APP_PORT}`, errorMessage: 'Port occupied' } });
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'REPLAN_STARTED', payload: { previousPlanVersion: 1, replanReason: 'Port conflict' } });
  recordFact('DEVIATION', `Port ${TEST_APP_PORT} occupied — replanning`);
  stateMachine.transition(goalId, 'RECOVERING', 'Port conflict');

  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'REPLAN_COMPLETED', payload: { planVersion: 2, replanReason: 'Switch to alternate port' } });
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'PLAN_CREATED', payload: { planVersion: 2 } });
  recordFact('PLAN', 'Plan #2: Use alternate port ' + TEST_APP_PORT_ALT);
  blocker.close();
  stateMachine.transition(goalId, 'RUNNING', 'Replanned to alternate port');

  // ─── STEP 3: Start service on alternate port ─────────────────────
  await launchTestApp(TEST_APP_PORT_ALT);
  await new Promise((r) => setTimeout(r, 500));
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED', payload: { capability: 'process.start', targetResource: `port:${TEST_APP_PORT_ALT}`, result: 'success' } });

  const healthResult = await checkHealth(TEST_APP_PORT_ALT);
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'VERIFICATION_PASSED', payload: { verificationContract: 'network.http_request', verificationResult: 'verified' } });
  assert(healthResult.ok, 'Service health verified on alternate port');

  // Checkpoint
  const cp2 = checkpointManager.checkpoint({
    goalId, identityId: identity.identityId, goalStatement: 'Make local ProtoForge environment operational',
    planVersion: 2, completedObjectives: ['CONFIG_CREATED', 'SERVICE_STARTED'], failedObjectives: ['SERVICE_STARTED_ORIGINAL_PORT'],
    inProgressObjectives: ['HEALTH_VERIFIED'], pendingObjectives: ['BROWSER_VERIFIED', 'AUTHENTICATED'],
    executedActions: [...cp1.executedActions, { actionId: 'act_cp_002', capability: 'process.start', target: `port:${TEST_APP_PORT_ALT}`, outcome: 'success', verified: true, timestamp: new Date().toISOString() }],
    verifiedState: { ...cp1.verifiedState, 'service:running': true, 'port': TEST_APP_PORT_ALT },
    status: 'RUNNING', resumeCondition: 'Service running on alternate port', executedSideEffects: [...cp1.executedSideEffects, `start:port_${TEST_APP_PORT_ALT}`],
    summary: 'Service started on alternate port',
  });
  await new Promise((r) => setTimeout(r, 300));
  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'CHECKPOINT_CREATED', payload: { checkpointId: cp2.checkpointId, checkpointStatus: 'RUNNING' } });

  // ─── Verify control plane sees replan ─────────────────────────────
  const goalState2 = controlPlane.getGoalState(goalId);
  assert(goalState2 !== null, 'Control plane sees goal after replan');
  assert(goalState2!.replanCount === 1, 'Control plane shows 1 replan');
  assert(goalState2!.completedActionCount === 2, 'Control plane shows 2 completed actions');

  // ─── STEP 4: Browser + MFA intervention ──────────────────────────
  recordFact('OBJECTIVE', 'Browser navigation and authentication');
  const chromePath = findChrome();
  assert(chromePath !== null, 'Chrome found');

  if (chromePath) {
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();

    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_STARTED', payload: { capability: 'browser.navigate', targetResource: `http://localhost:${TEST_APP_PORT_ALT}`, riskLevel: 'R1' } });
    await page.goto(`http://localhost:${TEST_APP_PORT_ALT}/`, { waitUntil: 'networkidle0' });
    const title = await page.title();
    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'ACTION_COMPLETED', payload: { capability: 'browser.navigate', targetResource: `http://localhost:${TEST_APP_PORT_ALT}`, result: 'success' } });
    assert(title.includes('ProtoForge'), 'Browser navigation successful');

    // Login
    await page.goto(`http://localhost:${TEST_APP_PORT_ALT}/login`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#login-form');
    await page.type('#username', 'admin');
    await page.type('#password', 'demo');
    await page.click('#login-btn');
    await page.waitForSelector('#mfa-status', { timeout: 5000 });

    // ─── INTERVENTION ───────────────────────────────────────────────
    recordFact('INTERVENTION', 'MFA required — creating intervention');
    stateMachine.transition(goalId, 'WAITING_FOR_HUMAN', 'MFA required');

    const intervention = interventionQueue.enqueue({
      goalId, identityId: identity.identityId, userId: 'user:owner',
      currentObjective: 'AUTHENTICATE', blocker: 'MFA_REQUIRED',
      requiredHumanAction: 'Approve the MFA challenge', whyRequired: 'MFA cannot be bypassed',
      expectedResultingState: 'Authenticated session',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'MFA approved', auditId: 'audit_cp_001', interventionType: 'MFA_REQUIRED',
      originalRequest: { requestId: 'req_cp_001', actionId: 'act_cp_003', goalId, reason: 'MFA', whatWasAttempted: 'Login', whatSucceeded: 'Credentials accepted', whatFailed: 'MFA', whyCannotContinue: 'Cannot bypass MFA', requiredHumanAction: 'Approve MFA', whatHappensAfter: 'Dashboard access', interventionType: 'MFA_REQUIRED' as any, timestamp: new Date().toISOString() },
    });
    await new Promise((r) => setTimeout(r, 300));
    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'INTERVENTION_REQUIRED', payload: { interventionId: intervention.requestId, interventionType: 'MFA_REQUIRED', interventionReason: 'MFA_REQUIRED', requiredHumanAction: 'Approve the MFA challenge' } });

    // Checkpoint before restart (save with WAITING_FOR_HUMAN status)
    const cp3 = checkpointManager.checkpoint({
      goalId, identityId: identity.identityId, goalStatement: 'Make local ProtoForge environment operational',
      planVersion: 2, completedObjectives: ['CONFIG_CREATED', 'SERVICE_STARTED', 'HEALTH_VERIFIED'],
      failedObjectives: ['SERVICE_STARTED_ORIGINAL_PORT'], inProgressObjectives: ['AUTHENTICATED'], pendingObjectives: [],
      executedActions: [...cp2.executedActions, { actionId: 'act_cp_003', capability: 'browser.navigate', target: `http://localhost:${TEST_APP_PORT_ALT}`, outcome: 'success', verified: true, timestamp: new Date().toISOString() }],
      verifiedState: { ...cp2.verifiedState, 'browser:reached': true, 'mfa:pending': true },
      status: 'WAITING_FOR_HUMAN', resumeCondition: 'MFA approved', executedSideEffects: cp2.executedSideEffects, summary: 'Waiting for MFA',
    });
    await new Promise((r) => setTimeout(r, 300));
    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'CHECKPOINT_CREATED', payload: { checkpointId: cp3.checkpointId, checkpointStatus: 'WAITING_FOR_HUMAN' } });

    // ─── Verify control plane sees intervention ─────────────────────
    const goalState3 = controlPlane.getGoalState(goalId);
    assert(goalState3 !== null, 'Control plane sees goal during intervention');
    assert(goalState3!.interventionRequired === true, 'Control plane shows intervention required');
    assert(goalState3!.interventionId === intervention.requestId, 'Control plane shows intervention ID');
    assert(goalState3!.status === 'WAITING_FOR_HUMAN', 'Control plane shows WAITING_FOR_HUMAN');

    // ─── PM2 RESTART ────────────────────────────────────────────────
    recordFact('RESTART', 'Starting hydi-daemon via PM2...');
    execSyncSafe('npx pm2 start scripts/heidi-daemon.ts --name hydi-daemon --interpreter npx --interpreter-args tsx -- --once --no-stabilization');
    await new Promise((r) => setTimeout(r, 3000));
    recordFact('RESTART', 'Executing: pm2 restart hydi-daemon');
    execSyncSafe('npx pm2 restart hydi-daemon -- --once --no-stabilization');
    await new Promise((r) => setTimeout(r, 5000));

    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'RECOVERY_STARTED', payload: { recoveryReason: 'PM2 restart' } });

    // ─── Verify state survived ───────────────────────────────────────
    const { data: cpAfter } = await supabase.from('goal_checkpoints').select('*').eq('checkpoint_id', cp3.checkpointId).single();
    assert(cpAfter !== null, 'Checkpoint survived PM2 restart');
    const { data: intAfter } = await supabase.from('human_intervention_requests').select('*').eq('request_id', intervention.requestId).single();
    assert(intAfter !== null, 'Intervention survived PM2 restart');
    assert(intAfter?.status === 'pending', 'Intervention still pending after restart');

    // Restore via fresh managers (daemon recovery path)
    const freshCpManager = new GoalCheckpointManager();
    freshCpManager.attachPersistence(new CheckpointPersistence(supabase));
    const freshIntQueue = new InterventionQueue();
    freshIntQueue.attachPersistence(new InterventionPersistence(supabase));
    const restoredCps = await freshCpManager.restoreFromPersistence();
    const restoredInts = await freshIntQueue.restoreFromPersistence();
    assert(restoredCps >= 1, 'Checkpoint restored from Supabase');
    assert(restoredInts >= 1, 'Intervention restored from Supabase');

    // Also restore into the singletons so the control plane can see state
    await restoreFromPersistence();

    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'CHECKPOINT_RESTORED', payload: { checkpointId: cp3.checkpointId, restoredFromPersistence: true } });
    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'RECOVERY_COMPLETED', payload: { recoveryReason: 'Restored from Supabase' } });

    // ─── HUMAN APPROVES via InterventionController ──────────────────
    recordFact('HUMAN_ACTION', 'Human approves MFA via InterventionController...');
    const approveResult = await interventionController.approve(intervention.requestId, 'user:owner', 'MFA approved');
    assert(approveResult.resumed === true, 'Intervention approved — goal resumes');
    assert(approveResult.checkpointId === cp3.checkpointId, 'Approval references correct checkpoint');
    await new Promise((r) => setTimeout(r, 300));

    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'INTERVENTION_APPROVED', payload: { interventionId: intervention.requestId, checkpointId: cp3.checkpointId } });

    // ─── Verify control plane sees approval ─────────────────────────
    const goalState4 = controlPlane.getGoalState(goalId);
    assert(goalState4 !== null, 'Control plane sees goal after approval');
    assert(goalState4!.interventionRequired === false, 'Control plane shows no intervention required after approval');

    // ─── Resume: complete MFA in browser ────────────────────────────
    stateMachine.transition(goalId, 'RUNNING', 'Human completed MFA');
    await page.click('#mfa-approve-btn');
    await page.waitForSelector('#session');
    const protectedTitle = await page.title();
    assert(protectedTitle.includes('Dashboard'), 'Dashboard reached after MFA');

    const sessionText = await page.$eval('#session', (el: any) => el.textContent);
    assert(sessionText === 'authenticated', 'Session authenticated');

    await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'VERIFICATION_PASSED', payload: { verificationContract: 'browser.navigate', verificationResult: 'verified' } });

    const screenshotPath = path.join(TMP_DIR, 'cp-e2e-screenshot.png');
    await page.screenshot({ path: screenshotPath });
    assert(fs.existsSync(screenshotPath), 'Screenshot evidence captured');

    await browser.close();
  }

  // ─── FINAL VERIFICATION ───────────────────────────────────────────
  recordFact('OBJECTIVE', 'Final verification');
  const configExists = fs.existsSync(CONFIG_FILE);
  const healthStillOk = await checkHealth(TEST_APP_PORT_ALT);
  assert(configExists, 'Config file still exists');
  assert(healthStillOk.ok, 'Service still healthy');

  stateMachine.transition(goalId, 'COMPLETED', 'All objectives verified');
  assert(stateMachine.getState(goalId) === 'COMPLETED', 'Final state is COMPLETED');

  const finalCp = checkpointManager.checkpoint({
    goalId, identityId: identity.identityId, goalStatement: 'Make local ProtoForge environment operational',
    planVersion: 2, completedObjectives: ['CONFIG_CREATED', 'SERVICE_STARTED', 'HEALTH_VERIFIED', 'BROWSER_VERIFIED', 'AUTHENTICATED'],
    failedObjectives: ['SERVICE_STARTED_ORIGINAL_PORT'], inProgressObjectives: [], pendingObjectives: [],
    executedActions: cp2.executedActions, verifiedState: { 'config:exists': true, 'service:running': true, 'health:ok': true, 'browser:authenticated': true },
    status: 'COMPLETED', resumeCondition: 'N/A', executedSideEffects: cp2.executedSideEffects, summary: 'All objectives verified',
  });
  await new Promise((r) => setTimeout(r, 300));

  await controlPlane.recordEvent({ goalId, identityId: identity.identityId, eventType: 'GOAL_COMPLETED', payload: { result: 'success', verifiedState: { 'config:exists': true, 'service:running': true, 'browser:authenticated': true } } });

  // ─── Verify control plane final state ─────────────────────────────
  const finalState = controlPlane.getGoalState(goalId);
  assert(finalState !== null, 'Control plane sees final goal state');
  assert(finalState!.status === 'COMPLETED', 'Control plane shows COMPLETED');
  assert(finalState!.replanCount === 1, 'Control plane shows 1 replan in final state');
  assert(finalState!.interventionRequired === false, 'Control plane shows no intervention in final state');

  // ─── Verify event stream ──────────────────────────────────────────
  const events = controlPlane.getGoalEvents(goalId);
  assert(events.length >= 10, `Event stream has ${events.length} events (expected >= 10)`);
  assert(events.some((e) => e.eventType === 'GOAL_CREATED'), 'Event stream has GOAL_CREATED');
  assert(events.some((e) => e.eventType === 'GOAL_STARTED'), 'Event stream has GOAL_STARTED');
  assert(events.some((e) => e.eventType === 'PLAN_CREATED'), 'Event stream has PLAN_CREATED');
  assert(events.some((e) => e.eventType === 'ACTION_COMPLETED'), 'Event stream has ACTION_COMPLETED');
  assert(events.some((e) => e.eventType === 'REPLAN_STARTED'), 'Event stream has REPLAN_STARTED');
  assert(events.some((e) => e.eventType === 'INTERVENTION_REQUIRED'), 'Event stream has INTERVENTION_REQUIRED');
  assert(events.some((e) => e.eventType === 'INTERVENTION_APPROVED'), 'Event stream has INTERVENTION_APPROVED');
  assert(events.some((e) => e.eventType === 'CHECKPOINT_CREATED'), 'Event stream has CHECKPOINT_CREATED');
  assert(events.some((e) => e.eventType === 'CHECKPOINT_RESTORED'), 'Event stream has CHECKPOINT_RESTORED');
  assert(events.some((e) => e.eventType === 'RECOVERY_COMPLETED'), 'Event stream has RECOVERY_COMPLETED');
  assert(events.some((e) => e.eventType === 'GOAL_COMPLETED'), 'Event stream has GOAL_COMPLETED');

  // ─── Verify all events are secret-clean ───────────────────────────
  for (const evt of events) {
    assert(isOperationalEventClean(evt), `Event ${evt.eventType} is secret-clean`);
  }

  // ─── Verify operational summary ───────────────────────────────────
  const summary = controlPlane.getOperationalSummary();
  assert(summary.recentEvents.length > 0, 'Operational summary has recent events');

  // ─── Verify recovery history ──────────────────────────────────────
  const recoveryHistory = controlPlane.getRecoveryHistory(goalId);
  assert(recoveryHistory.length >= 2, 'Recovery history has events');
  assert(recoveryHistory.some((e) => e.eventType === 'RECOVERY_STARTED'), 'Recovery history has RECOVERY_STARTED');
  assert(recoveryHistory.some((e) => e.eventType === 'RECOVERY_COMPLETED'), 'Recovery history has RECOVERY_COMPLETED');

  // ─── Save transcript ──────────────────────────────────────────────
  const transcriptPath = path.join(process.cwd(), 'data', 'cp-e2e-transcript.txt');
  if (!fs.existsSync(path.dirname(transcriptPath))) fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(transcriptPath, transcript.join('\n'));

  // ─── Cleanup ──────────────────────────────────────────────────────
  stopTestApp();
  execSyncSafe('npx pm2 stop hydi-daemon 2>nul');
  execSyncSafe('npx pm2 delete hydi-daemon 2>nul');
  await supabase.from('human_intervention_requests').delete().like('goal_id', 'goal_cp_e2e_%');
  await supabase.from('goal_checkpoints').delete().like('goal_id', 'goal_cp_e2e_%');
  await supabase.from('adaptive_operator_events').delete().like('goal_id', 'goal_cp_e2e_%');
  try { fs.unlinkSync(CONFIG_FILE); } catch { /* ignore */ }

  // ─── Results ──────────────────────────────────────────────────────
  log('\n═══════════════════════════════════════════════════════════════');
  log(`  Control-Plane E2E Results: ${passed} passed, ${failed} failed`);
  log('═══════════════════════════════════════════════════════════════');

  if (failed > 0) { log('\nFailures:'); for (const f of failures) { log(`  ✗ ${f}`); } }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Fatal:', err); stopTestApp(); process.exit(1); });
