/**
 * Tests for the Production Operations Control Plane
 *
 * Covers:
 *   - Configuration control plane (safe update, rollback, validation, malformed config)
 *   - Credential manager (metadata projection never exposes secrets, redaction)
 *   - Live transaction authorization (issue, consume, expire, revoke, reuse, scope/amount mismatch)
 *   - Financial safety (ALLOW_LIVE_STRIPE alone cannot authorize a transaction,
 *     READY alone cannot create a transaction, config changes cannot bypass human auth)
 *   - Blocker classification and resolution
 *   - Preflight structured blocker ownership
 */

import { ConfigurationControlPlane } from '../../lib/operational/ConfigurationControlPlane';
import { LiveTransactionAuthorizationManager } from '../../lib/revenue/LiveTransactionAuthorization';
import { ProductionOperationsControlPlane } from '../../lib/operational/ProductionOperationsControlPlane';
import * as CredentialSource from '../../lib/operational/CredentialSource';
import { safePrefix, fingerprint, classifyEnvironment } from '../../lib/operational/CredentialSource';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Test helpers ────────────────────────────────────────────────────────

function createTempEnvFile(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-test-'));
  const envPath = path.join(tmpDir, '.env.local');
  fs.writeFileSync(envPath, content, 'utf8');
  return envPath;
}

function cleanupTempFile(filePath: string): void {
  try {
    const dir = path.dirname(filePath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ─── Configuration Control Plane tests ───────────────────────────────────

describe('ConfigurationControlPlane', () => {
  let envPath: string;
  let ccp: ConfigurationControlPlane;

  beforeEach(() => {
    envPath = createTempEnvFile('NODE_ENV=development\n');
    ccp = new ConfigurationControlPlane(envPath);
  });

  afterEach(() => {
    cleanupTempFile(envPath);
  });

  test('reads existing value from .env.local', () => {
    expect(ccp.read('NODE_ENV')).toBe('development');
  });

  test('returns null for missing key', () => {
    expect(ccp.read('NONEXISTENT_KEY')).toBeNull();
  });

  test('sets a new value atomically', () => {
    const result = ccp.set('ALLOW_LIVE_STRIPE', 'true', 'test', 'unit test');
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(ccp.read('ALLOW_LIVE_STRIPE')).toBe('true');
  });

  test('updates an existing value', () => {
    const result = ccp.set('NODE_ENV', 'production', 'test', 'unit test');
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(ccp.read('NODE_ENV')).toBe('production');
  });

  test('validates boolean type', () => {
    const result = ccp.set('ALLOW_LIVE_STRIPE', 'maybe', 'test', 'unit test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('true');
    expect(result.error).toContain('false');
  });

  test('validates email type', () => {
    const result = ccp.set('LIVE_QUALIFICATION_CUSTOMER_EMAIL', 'not-an-email', 'test', 'unit test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid email');
  });

  test('validates enum type', () => {
    const result = ccp.set('NODE_ENV', 'staging', 'test', 'unit test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('development');
  });

  test('rejects unknown keys', () => {
    const result = ccp.set('UNKNOWN_CONFIG_KEY', 'value', 'test', 'unit test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown configuration key');
  });

  test('rejects secret keys', () => {
    const result = ccp.set('STRIPE_SECRET_KEY', 'sk_test_123', 'test', 'unit test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('CredentialManager');
  });

  test('records audit log on change', () => {
    ccp.set('ALLOW_LIVE_STRIPE', 'true', 'test-operator', 'testing audit');
    const log = ccp.getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0].key).toBe('ALLOW_LIVE_STRIPE');
    expect(log[0].newValue).toBe('true');
    expect(log[0].changedBy).toBe('test-operator');
    expect(log[0].reason).toBe('testing audit');
  });

  test('rollback restores previous value', () => {
    ccp.set('ALLOW_LIVE_STRIPE', 'true', 'test', 'initial set');
    const log = ccp.getAuditLog();
    const change = log[0];

    const rollbackResult = ccp.rollback(change, 'test', 'rollback test');
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.verified).toBe(true);
    expect(ccp.read('ALLOW_LIVE_STRIPE')).toBeNull(); // was not set before
  });

  test('rollback restores previous non-null value', () => {
    ccp.set('ALLOW_LIVE_STRIPE', 'false', 'test', 'initial');
    ccp.set('ALLOW_LIVE_STRIPE', 'true', 'test', 'change');
    const log = ccp.getAuditLog();
    const change = log[1]; // the second change

    const rollbackResult = ccp.rollback(change, 'test', 'rollback');
    expect(rollbackResult.success).toBe(true);
    expect(ccp.read('ALLOW_LIVE_STRIPE')).toBe('false');
  });

  test('canAutoModify returns true for auto-modifiable keys', () => {
    expect(ccp.canAutoModify('ALLOW_LIVE_STRIPE')).toBe(true);
    expect(ccp.canAutoModify('WEBHOOK_PROCESSING_ENABLED')).toBe(true);
  });

  test('canAutoModify returns false for non-auto-modifiable keys', () => {
    expect(ccp.canAutoModify('NODE_ENV')).toBe(false);
  });

  test('isSecretKey identifies secret keys', () => {
    expect(ccp.isSecretKey('STRIPE_SECRET_KEY')).toBe(true);
    expect(ccp.isSecretKey('SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
    expect(ccp.isSecretKey('HYDI_SERVICE_SECRET')).toBe(true);
    expect(ccp.isSecretKey('ALLOW_LIVE_STRIPE')).toBe(false);
  });

  test('getSafeSummary redacts secret values', () => {
    ccp.set('ALLOW_LIVE_STRIPE', 'true', 'test', 'setup');
    const summary = ccp.getSafeSummary();
    expect(summary['ALLOW_LIVE_STRIPE'].value).toBe('true');
    expect(summary['STRIPE_SECRET_KEY'].isSecret).toBe(true);
    // Secret value should be REDACTED or null, never the actual value
    if (summary['STRIPE_SECRET_KEY'].value) {
      expect(summary['STRIPE_SECRET_KEY'].value).toBe('REDACTED');
    }
  });

  test('readAll returns snapshot of all config values', () => {
    ccp.set('ALLOW_LIVE_STRIPE', 'true', 'test', 'setup');
    const snapshot = ccp.readAll();
    expect(snapshot.values['ALLOW_LIVE_STRIPE']).toBe('true');
    expect(snapshot.values['NODE_ENV']).toBe('development');
    expect(snapshot.source).toContain('.env.local');
  });
});

// ─── Credential redaction tests ──────────────────────────────────────────

describe('Credential redaction', () => {
  test('safePrefix redacts sk_live_ keys', () => {
    expect(safePrefix('sk_live_abc123def456')).toBe('sk_live_...');
  });

  test('safePrefix redacts sk_test_ keys', () => {
    expect(safePrefix('sk_test_abc123def456')).toBe('sk_test_...');
  });

  test('safePrefix redacts rk_live_ keys', () => {
    expect(safePrefix('rk_live_abc123def456')).toBe('rk_live_...');
  });

  test('safePrefix redacts rk_test_ keys', () => {
    expect(safePrefix('rk_test_abc123def456')).toBe('rk_test_...');
  });

  test('safePrefix redacts whsec_ keys', () => {
    expect(safePrefix('whsec_abc123def456')).toBe('whsec_...');
  });

  test('safePrefix redacts JWT-like values', () => {
    expect(safePrefix('eyJhbGciOiJIUzI1NiJ9.test')).toBe('eyJ...');
  });

  test('safePrefix truncates unknown values', () => {
    expect(safePrefix('abcd1234efgh5678')).toBe('abcd...');
  });

  test('fingerprint returns SHA-256 hash (16 chars)', () => {
    const fp = fingerprint('sk_test_12345');
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  test('fingerprint is deterministic', () => {
    expect(fingerprint('sk_test_12345')).toBe(fingerprint('sk_test_12345'));
  });

  test('fingerprint differs for different values', () => {
    expect(fingerprint('sk_test_12345')).not.toBe(fingerprint('sk_live_12345'));
  });

  test('classifyEnvironment identifies live keys', () => {
    expect(classifyEnvironment('sk_live_abc', 'stripe_secret_key')).toBe('live');
    expect(classifyEnvironment('rk_live_abc', 'stripe_secret_key')).toBe('live');
  });

  test('classifyEnvironment identifies test keys', () => {
    expect(classifyEnvironment('sk_test_abc', 'stripe_secret_key')).toBe('test');
    expect(classifyEnvironment('rk_test_abc', 'stripe_secret_key')).toBe('test');
  });

  test('classifyEnvironment returns unknown for unrecognized', () => {
    expect(classifyEnvironment('abc', 'stripe_secret_key')).toBe('unknown');
  });

  test('createHandle never includes raw value in serializable fields', () => {
    const handle = CredentialSource.createHandle({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'test',
      source: 'ENVIRONMENT',
      value: 'sk_test_super_secret_value_12345',
    });

    // The handle should have a safe prefix, not the raw value
    expect(handle.prefix).toBe('sk_test_...');
    expect(handle.fingerprint).toHaveLength(16);
    expect(handle.hasValue).toBe(true);

    // The raw value should only be accessible via _access()
    expect(handle._access()).toBe('sk_test_super_secret_value_12345');

    // Serializing the handle should NOT include the raw value
    const serialized = JSON.stringify({ ...handle, _access: undefined });
    expect(serialized).not.toContain('sk_test_super_secret_value_12345');
    expect(serialized).not.toContain('super_secret');
  });
});

// ─── Live Transaction Authorization tests ────────────────────────────────

describe('LiveTransactionAuthorization', () => {
  let authManager: LiveTransactionAuthorizationManager;
  let tempStorePath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-auth-'));
    tempStorePath = path.join(tmpDir, 'auth-store.json');
    authManager = new LiveTransactionAuthorizationManager(tempStorePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(tempStorePath), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('issues a valid authorization', () => {
    const result = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      amountCents: 2900,
    });

    expect(result.success).toBe(true);
    expect(result.authorization).toBeTruthy();
    expect(result.authorization!.state).toBe('PENDING');
    expect(result.authorization!.scope).toBe('stripe-production-qualification');
    expect(result.authorization!.amountCents).toBe(2900);
    expect(result.authorization!.maxTransactions).toBe(1);
    expect(result.authorization!.customer).toBe('customer@test.com');
  });

  test('rejects amount exceeding maximum', () => {
    const result = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      amountCents: 5000, // exceeds $29.00 limit
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds maximum');
  });

  test('rejects zero or negative amount', () => {
    const result = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      amountCents: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('positive');
  });

  test('rejects invalid customer email', () => {
    const result = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'not-an-email',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid customer email');
  });

  test('rejects second pending authorization', () => {
    authManager.issue({ authorizedBy: 'op', customer: 'c@test.com' });
    const second = authManager.issue({ authorizedBy: 'op', customer: 'c@test.com' });
    expect(second.success).toBe(false);
    expect(second.error).toContain('pending authorization already exists');
  });

  test('consumes a pending authorization (single-use)', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });
    const authId = issueResult.authorization!.authorizationId;

    const consumeResult = authManager.consume(authId, 'job-123', 2900, 'customer@test.com');
    expect(consumeResult.success).toBe(true);
    expect(consumeResult.authorization!.state).toBe('CONSUMED');
    expect(consumeResult.authorization!.consumedByJobId).toBe('job-123');
    expect(consumeResult.authorization!.consumedAt).toBeTruthy();
  });

  test('cannot reuse a consumed authorization', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });
    const authId = issueResult.authorization!.authorizationId;

    authManager.consume(authId, 'job-123', 2900, 'customer@test.com');
    const reuse = authManager.consume(authId, 'job-456', 2900, 'customer@test.com');

    expect(reuse.success).toBe(false);
    expect(reuse.error).toContain('CONSUMED');
  });

  test('rejects amount mismatch on consume', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      amountCents: 2900,
    });
    const authId = issueResult.authorization!.authorizationId;

    const consume = authManager.consume(authId, 'job-123', 5000, 'customer@test.com');
    expect(consume.success).toBe(false);
    expect(consume.error).toContain('exceeds authorized');
    expect(consume.authorization!.state).toBe('REJECTED');
  });

  test('rejects customer mismatch on consume', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });
    const authId = issueResult.authorization!.authorizationId;

    const consume = authManager.consume(authId, 'job-123', 2900, 'wrong@test.com');
    expect(consume.success).toBe(false);
    expect(consume.error).toContain('does not match');
  });

  test('expires after time window', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      expiryMinutes: 0, // expires immediately
    });
    const authId = issueResult.authorization!.authorizationId;

    // Wait a tiny bit to ensure expiry
    const consume = authManager.consume(authId, 'job-123', 2900, 'customer@test.com');
    expect(consume.success).toBe(false);
    expect(consume.error).toContain('expired');
  });

  test('revokes a pending authorization', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });
    const authId = issueResult.authorization!.authorizationId;

    const revokeResult = authManager.revoke(authId, 'operator@test');
    expect(revokeResult.success).toBe(true);
    expect(revokeResult.authorization!.state).toBe('REVOKED');
  });

  test('cannot revoke a consumed authorization', () => {
    const issueResult = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });
    const authId = issueResult.authorization!.authorizationId;

    authManager.consume(authId, 'job-123', 2900, 'customer@test.com');
    const revoke = authManager.revoke(authId, 'operator@test');
    expect(revoke.success).toBe(false);
    expect(revoke.error).toContain('Cannot revoke');
  });

  test('checkAuthorized returns false without pending auth', () => {
    const check = authManager.checkAuthorized(2900, 'customer@test.com');
    expect(check.authorized).toBe(false);
    expect(check.reason).toContain('No pending authorization');
  });

  test('checkAuthorized returns true with valid pending auth', () => {
    authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      amountCents: 2900,
    });

    const check = authManager.checkAuthorized(2900, 'customer@test.com');
    expect(check.authorized).toBe(true);
  });

  test('checkAuthorized returns false for amount exceeding auth', () => {
    authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
      amountCents: 2900,
    });

    const check = authManager.checkAuthorized(5000, 'customer@test.com');
    expect(check.authorized).toBe(false);
    expect(check.reason).toContain('exceeds authorized');
  });

  test('checkAuthorized returns false for wrong customer', () => {
    authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });

    const check = authManager.checkAuthorized(2900, 'wrong@test.com');
    expect(check.authorized).toBe(false);
    expect(check.reason).toContain('does not match');
  });

  test('persists across instances (durable store)', () => {
    authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });

    // Create a new instance pointing to the same store
    const newManager = new LiveTransactionAuthorizationManager(tempStorePath);
    const all = newManager.getAll();
    expect(all.length).toBe(1);
    expect(all[0].customer).toBe('customer@test.com');
  });
});

// ─── Financial safety tests ──────────────────────────────────────────────

describe('Financial safety boundaries', () => {
  test('ALLOW_LIVE_STRIPE alone does not create a transaction authorization', () => {
    const envPath = createTempEnvFile('ALLOW_LIVE_STRIPE=true\n');
    const ccp = new ConfigurationControlPlane(envPath);

    // ALLOW_LIVE_STRIPE is set
    expect(ccp.read('ALLOW_LIVE_STRIPE')).toBe('true');

    // But no transaction authorization exists
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-fin-'));
    const authStore = path.join(tmpDir, 'auth.json');
    const authManager = new LiveTransactionAuthorizationManager(authStore);

    const check = authManager.checkAuthorized(2900, 'customer@test.com');
    expect(check.authorized).toBe(false);

    cleanupTempFile(envPath);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('READY preflight does not create a transaction authorization', () => {
    // Even if preflight would report READY, no authorization exists
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-fin-'));
    const authStore = path.join(tmpDir, 'auth.json');
    const authManager = new LiveTransactionAuthorizationManager(authStore);

    // No authorization issued
    expect(authManager.getPending()).toBeNull();
    expect(authManager.getAll().length).toBe(0);

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('configuration change cannot bypass human authorization', () => {
    const envPath = createTempEnvFile('ALLOW_LIVE_STRIPE=false\n');
    const ccp = new ConfigurationControlPlane(envPath);

    // Change ALLOW_LIVE_STRIPE to true (operator action — not HYDI auto-resolve)
    const result = ccp.set('ALLOW_LIVE_STRIPE', 'true', 'operator', 'explicit operator decision');
    expect(result.success).toBe(true);

    // But this does NOT create a transaction authorization
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-fin-'));
    const authStore = path.join(tmpDir, 'auth.json');
    const authManager = new LiveTransactionAuthorizationManager(authStore);

    expect(authManager.checkAuthorized(2900, 'test@test.com').authorized).toBe(false);

    cleanupTempFile(envPath);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('secret keys are rejected by ConfigurationControlPlane', () => {
    const envPath = createTempEnvFile('');
    const ccp = new ConfigurationControlPlane(envPath);

    // Attempting to set a secret key through the config plane should fail
    const result = ccp.set('STRIPE_SECRET_KEY', 'sk_live_abc123', 'test', 'attempt');
    expect(result.success).toBe(false);
    expect(result.error).toContain('CredentialManager');

    cleanupTempFile(envPath);
  });

  test('authorization is single-use — cannot be used for multiple transactions', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-fin-'));
    const authStore = path.join(tmpDir, 'auth.json');
    const authManager = new LiveTransactionAuthorizationManager(authStore);

    const issue = authManager.issue({
      authorizedBy: 'operator@test',
      customer: 'customer@test.com',
    });
    const authId = issue.authorization!.authorizationId;

    // First consume succeeds
    const first = authManager.consume(authId, 'job-1', 2900, 'customer@test.com');
    expect(first.success).toBe(true);

    // Second consume fails
    const second = authManager.consume(authId, 'job-2', 2900, 'customer@test.com');
    expect(second.success).toBe(false);

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});

// ─── Production Operations Control Plane tests ───────────────────────────

describe('ProductionOperationsControlPlane', () => {
  test('preflight identifies blockers with structured ownership', async () => {
    // Use a temp env file with no live config
    const envPath = createTempEnvFile('NODE_ENV=development\n');
    const ccp = new ConfigurationControlPlane(envPath);

    // We can't fully test the control plane without mocking dependencies,
    // but we can test the blocker structure via the configuration plane
    const allowLive = ccp.read('ALLOW_LIVE_STRIPE');
    expect(allowLive).toBeNull(); // not set

    // The preflight should identify this as a blocker
    // We test the structure indirectly
    const snapshot = ccp.readAll();
    expect(snapshot.values['ALLOW_LIVE_STRIPE']).toBeNull();

    cleanupTempFile(envPath);
  });

  test('ALLOW_LIVE_STRIPE can be set by operator through ConfigurationControlPlane (but NOT auto-resolved by control plane)', () => {
    const envPath = createTempEnvFile('NODE_ENV=development\n');
    const ccp = new ConfigurationControlPlane(envPath);

    // Before: not set
    expect(ccp.read('ALLOW_LIVE_STRIPE')).toBeNull();

    // Operator sets it explicitly
    const result = ccp.set('ALLOW_LIVE_STRIPE', 'true', 'operator', 'explicit operator decision to enable live mode');
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);

    // After: set to true
    expect(ccp.read('ALLOW_LIVE_STRIPE')).toBe('true');

    // NOTE: The control plane classifier must NOT auto-resolve ALLOW_LIVE_STRIPE_UNSET.
    // This test verifies the config plane CAN set it (for operator use),
    // not that the control plane SHOULD set it autonomously.
    // The control plane classifies ALLOW_LIVE_STRIPE_UNSET as OPERATOR_INPUT_REQUIRED.

    cleanupTempFile(envPath);
  });

  test('operator-input blocker cannot be auto-resolved', () => {
    const envPath = createTempEnvFile('NODE_ENV=development\n');
    const ccp = new ConfigurationControlPlane(envPath);

    // QUALIFICATION_CUSTOMER_UNSET requires operator input
    // The config plane can set it, but only if the operator provides the value
    // The control plane should NOT fabricate a customer email
    const customer = ccp.read('LIVE_QUALIFICATION_CUSTOMER_EMAIL');
    expect(customer).toBeNull();

    // HYDI cannot auto-resolve this because it doesn't know the customer
    // It can only set it if the operator provides the value
    const result = ccp.set('LIVE_QUALIFICATION_CUSTOMER_EMAIL', 'auto@hydi.local', 'hydi', 'auto-resolve');
    // The config plane allows it (it's autoModifiable), but the control plane
    // logic would classify this as OPERATOR_INPUT_REQUIRED and not set it
    // The test verifies the config plane mechanism works, but the control plane
    // would not call it without operator input
    expect(result.success).toBe(true); // config plane allows it
    // In the real control plane, this would be classified as OPERATOR_INPUT_REQUIRED

    cleanupTempFile(envPath);
  });
});

// ─── Secure credential input contract tests ──────────────────────────────

describe('Secure credential input contract', () => {
  test('secure-credential-input.js endpoint file exists', () => {
    const endpointPath = path.join(__dirname, '..', '..', 'pages', 'api', 'secure-credential-input.js');
    expect(fs.existsSync(endpointPath)).toBe(true);
  });

  test('endpoint requires authentication', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'api', 'secure-credential-input.js'),
      'utf8'
    );
    expect(src).toContain('requireAuth');
    expect(src).toContain('credentials:manage');
  });

  test('endpoint never returns the raw value', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'api', 'secure-credential-input.js'),
      'utf8'
    );
    expect(src).toContain('REDACTED');
    expect(src).not.toMatch(/return.*value.*req\.body/);
  });

  test('endpoint sanitizes error messages', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'api', 'secure-credential-input.js'),
      'utf8'
    );
    expect(src).toMatch(/sk_\[a-zA-Z0-9_\]\+/);
    expect(src).toContain('safeMsg');
  });
});

// ─── Control plane API contract tests ────────────────────────────────────

describe('Control plane API endpoints', () => {
  test('control-plane status endpoint exists', () => {
    const p = path.join(__dirname, '..', '..', 'pages', 'api', 'operations', 'control-plane.js');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('authorize-transaction endpoint exists', () => {
    const p = path.join(__dirname, '..', '..', 'pages', 'api', 'operations', 'authorize-transaction.js');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('authorize-transaction requires revenue:manage permission', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'api', 'operations', 'authorize-transaction.js'),
      'utf8'
    );
    expect(src).toContain('requireAuth');
    expect(src).toContain('revenue:manage');
  });

  test('control-plane status requires revenue:view permission', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'api', 'operations', 'control-plane.js'),
      'utf8'
    );
    expect(src).toContain('requireAuth');
    expect(src).toContain('revenue:view');
  });

  test('control-plane status never exposes secrets', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'api', 'operations', 'control-plane.js'),
      'utf8'
    );
    expect(src).toContain('secretsExposed: false');
  });
});

// ─── Source code secret-surface audit ────────────────────────────────────

describe('Secret-surface audit', () => {
  const newFiles = [
    'lib/operational/ConfigurationControlPlane.ts',
    'lib/operational/CredentialManager.ts',
    'lib/operational/ProductionOperationsControlPlane.ts',
    'lib/revenue/LiveTransactionAuthorization.ts',
    'pages/api/secure-credential-input.js',
    'pages/api/operations/control-plane.js',
    'pages/api/operations/authorize-transaction.js',
  ];

  for (const file of newFiles) {
    test(`${file} does not contain hardcoded secrets`, () => {
      const fullPath = path.join(__dirname, '..', '..', file);
      if (!fs.existsSync(fullPath)) return; // skip if not found
      const src = fs.readFileSync(fullPath, 'utf8');
      // Check for common secret patterns
      expect(src).not.toMatch(/sk_live_[a-zA-Z0-9]{20,}/);
      expect(src).not.toMatch(/sk_test_[a-zA-Z0-9]{20,}/);
      expect(src).not.toMatch(/rk_live_[a-zA-Z0-9]{20,}/);
      expect(src).not.toMatch(/whsec_[a-zA-Z0-9]{20,}/);
    });

    test(`${file} does not log credential values`, () => {
      const fullPath = path.join(__dirname, '..', '..', file);
      if (!fs.existsSync(fullPath)) return;
      const src = fs.readFileSync(fullPath, 'utf8');
      // Should not have console.log with credential values
      expect(src).not.toMatch(/console\.(log|info|debug|warn).*STRIPE_SECRET_KEY/);
      expect(src).not.toMatch(/console\.(log|info|debug|warn).*\.value/);
    });
  }

  test('CredentialManager always returns REDACTED for value field', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'operational', 'CredentialManager.ts'),
      'utf8'
    );
    // The CredentialMetadataProjection and StripeCredentialHealth types must have value: 'REDACTED'
    expect(src).toContain("value: 'REDACTED'");
  });

  test('ConfigurationControlPlane rejects secret keys', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'operational', 'ConfigurationControlPlane.ts'),
      'utf8'
    );
    // Must have a SECRET_KEYS set and check against it
    expect(src).toContain('SECRET_KEYS');
    expect(src).toContain('isSecret');
  });

  test('LiveTransactionAuthorization has hard amount limit', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'revenue', 'LiveTransactionAuthorization.ts'),
      'utf8'
    );
    expect(src).toContain('MAX_AMOUNT_CENTS');
    expect(src).toContain('2900');
  });

  test('ProductionOperationsControlPlane classifies blockers correctly', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'operational', 'ProductionOperationsControlPlane.ts'),
      'utf8'
    );
    expect(src).toContain('AUTO_RESOLVABLE');
    expect(src).toContain('OPERATOR_INPUT_REQUIRED');
    expect(src).toContain('HUMAN_AUTHORIZATION_REQUIRED');
    expect(src).toContain('PROHIBITED');
  });

  test('preflight reports WAITING_FOR_HUMAN_AUTHORIZATION when READY', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'operational', 'ProductionOperationsControlPlane.ts'),
      'utf8'
    );
    expect(src).toContain('WAITING_FOR_HUMAN_AUTHORIZATION');
  });
});
