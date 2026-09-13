/**
 * HYDI Secret Redaction Proof — Phase 3
 *
 * Uses disposable fake secrets.
 * Attempts to persist an intervention containing fake secrets.
 * Queries the ACTUAL database to verify no secret material exists.
 *
 * NO MOCKS — checks the real Supabase database.
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { InterventionQueue, InterventionPersistence } from '../lib/delegated-operator';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(message); console.log(`  ✗ ${message}`); }
}

// Disposable fake secrets — never real
const FAKE_API_KEY = 'sk_live_FAKE1234567890abcdef';
const FAKE_BEARER = 'Bearer FAKEeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakebody.fakesig';
const FAKE_PASSWORD = 'password=SuperSecretFakePassword123';
const FAKE_COOKIE = 'session_cookie=FAKEcookieValue456xyz';
const FAKE_MFA_SECRET = 'mfa_secret=FAKEJBSWY3DPEHPK3PXP';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HYDI Secret Redaction Proof — Real Database');
  console.log('  NO MOCKS — Verifies actual Supabase rows');
  console.log('═══════════════════════════════════════════════════════════════');

  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key);

  // Clean up
  await supabase.from('human_intervention_requests').delete().like('request_id', 'redact_test_%');

  // ─── Create intervention with fake secrets embedded ─────────────
  console.log('\n═══ Creating intervention with fake secrets embedded ═══');
  console.log(`  Fake API key: ${FAKE_API_KEY}`);
  console.log(`  Fake bearer: ${FAKE_BEARER.substring(0, 30)}...`);
  console.log(`  Fake password: ${FAKE_PASSWORD}`);
  console.log(`  Fake cookie: ${FAKE_COOKIE}`);
  console.log(`  Fake MFA secret: ${FAKE_MFA_SECRET}`);

  const queue = new InterventionQueue();
  const persistence = new InterventionPersistence(supabase);
  queue.attachPersistence(persistence);

  const intervention = queue.enqueue({
    goalId: 'goal_redact_test_001',
    identityId: 'identity_redact_test_001',
    userId: 'user:owner',
    currentObjective: `Login with ${FAKE_PASSWORD}`,
    blocker: `MFA required with ${FAKE_MFA_SECRET}`,
    requiredHumanAction: `Approve using key ${FAKE_API_KEY}`,
    whyRequired: `Cannot bypass with ${FAKE_BEARER}`,
    expectedResultingState: `Authenticated with ${FAKE_COOKIE}`,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    resumeCondition: `Cookie ${FAKE_COOKIE} valid`,
    auditId: 'audit_redact_test_001',
    interventionType: 'MFA_REQUIRED',
    originalRequest: {
      requestId: 'req_redact_001',
      actionId: 'action_redact_001',
      goalId: 'goal_redact_test_001',
      reason: `MFA with ${FAKE_MFA_SECRET}`,
      whatWasAttempted: `Login with ${FAKE_PASSWORD} and ${FAKE_API_KEY}`,
      whatSucceeded: `Got ${FAKE_BEARER}`,
      whatFailed: `MFA with ${FAKE_MFA_SECRET}`,
      whyCannotContinue: `Need ${FAKE_COOKIE}`,
      requiredHumanAction: `Approve with ${FAKE_API_KEY}`,
      whatHappensAfter: `Session with ${FAKE_BEARER}`,
      interventionType: 'MFA_REQUIRED' as any,
      timestamp: new Date().toISOString(),
    },
  });

  // Wait for async persistence
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // ─── Query the ACTUAL database ──────────────────────────────────
  console.log('\n═══ Querying actual database for secret material ═══');

  const { data: dbRow, error: dbError } = await supabase
    .from('human_intervention_requests')
    .select('*')
    .eq('request_id', intervention.requestId)
    .single();

  assert(dbError === null, `No error querying database: ${dbError?.message ?? 'OK'}`);
  assert(dbRow !== null, 'Row exists in database');

  // Serialize the entire row and check for secrets
  const fullRowJson = JSON.stringify(dbRow);
  console.log(`  Full row JSON length: ${fullRowJson.length} bytes`);

  // Check each fake secret
  assert(!fullRowJson.includes(FAKE_API_KEY), 'Fake API key NOT in database row');
  assert(!fullRowJson.includes(FAKE_BEARER), 'Fake Bearer token NOT in database row');
  assert(!fullRowJson.includes(FAKE_PASSWORD), 'Fake password NOT in database row');
  assert(!fullRowJson.includes(FAKE_COOKIE), 'Fake session cookie NOT in database row');
  assert(!fullRowJson.includes(FAKE_MFA_SECRET), 'Fake MFA secret NOT in database row');

  // Check for partial patterns too
  assert(!fullRowJson.includes('sk_live_FAKE'), 'No sk_live_FAKE pattern in database');
  assert(!fullRowJson.includes('SuperSecretFake'), 'No SuperSecretFake pattern in database');
  assert(!fullRowJson.includes('FAKEcookieValue'), 'No FAKEcookieValue pattern in database');
  assert(!fullRowJson.includes('FAKEJBSWY3DPEHPK3PXP'), 'No FAKE MFA secret pattern in database');

  // Check individual columns
  console.log('\n═══ Checking individual columns ═══');

  const columnsToCheck = [
    'objective', 'blocker', 'required_action', 'why_required',
    'expected_state', 'resume_condition', 'resolution_note',
  ];

  for (const col of columnsToCheck) {
    const value = String((dbRow as any)[col] ?? '');
    assert(!value.includes('sk_live_'), `${col}: no sk_live_ pattern`);
    assert(!value.includes('Bearer '), `${col}: no Bearer pattern`);
    assert(!value.includes('password='), `${col}: no password= pattern`);
    assert(!value.includes('session_cookie='), `${col}: no session_cookie= pattern`);
    assert(!value.includes('mfa_secret='), `${col}: no mfa_secret= pattern`);
  }

  // ─── Check that [REDACTED] appears where secrets were ───────────
  console.log('\n═══ Verifying redaction markers present ═══');

  // The blocker field had mfa_secret= — should be redacted
  assert(dbRow?.blocker.includes('[REDACTED]') || !dbRow?.blocker.includes('mfa_secret'),
    'Blocker field: mfa_secret redacted or removed');
  assert(dbRow?.required_action.includes('[REDACTED]') || !dbRow?.required_action.includes('sk_live'),
    'Required action: sk_live redacted or removed');

  // ─── Check adaptive_operator_events table ───────────────────────
  console.log('\n═══ Checking adaptive_operator_events for secrets ═══');

  const { data: eventsData } = await supabase
    .from('adaptive_operator_events')
    .select('*')
    .eq('goal_id', 'goal_redact_test_001');

  if (eventsData && eventsData.length > 0) {
    const eventsJson = JSON.stringify(eventsData);
    assert(!eventsJson.includes(FAKE_API_KEY), 'No fake API key in adaptive_operator_events');
    assert(!eventsJson.includes(FAKE_PASSWORD), 'No fake password in adaptive_operator_events');
    assert(!eventsJson.includes(FAKE_BEARER), 'No fake Bearer in adaptive_operator_events');
  } else {
    console.log('  (no events in adaptive_operator_events for this goal — OK)');
  }

  // ─── Check PM2 logs for secrets ─────────────────────────────────
  console.log('\n═══ Checking PM2 logs for secret material ═══');

  try {
    const { execSync } = require('child_process');
    const pm2LogPath = execSync('npx pm2 info hydi-boot 2>nul | findstr "out log"').toString();
    console.log(`  PM2 log path: ${pm2LogPath.trim()}`);

    // Read the log file and check for secrets
    const logPathMatch = pm2LogPath.match(/out log path:\s*(.+)/);
    if (logPathMatch) {
      const logPath = logPathMatch[1].trim();
      const fs = require('fs');
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const recentLog = logContent.substring(Math.max(0, logContent.length - 10000));
        assert(!recentLog.includes(FAKE_API_KEY), 'No fake API key in PM2 logs');
        assert(!recentLog.includes(FAKE_PASSWORD), 'No fake password in PM2 logs');
        assert(!recentLog.includes(FAKE_BEARER), 'No fake Bearer in PM2 logs');
      } else {
        console.log(`  Log file not found: ${logPath}`);
      }
    }
  } catch (err) {
    console.log(`  PM2 log check skipped: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // ─── Cleanup ────────────────────────────────────────────────────
  console.log('\n═══ Cleanup ═══');
  await supabase.from('human_intervention_requests').delete().like('request_id', 'redact_test_%');

  // Results
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
  console.error('Fatal:', err);
  process.exit(1);
});
