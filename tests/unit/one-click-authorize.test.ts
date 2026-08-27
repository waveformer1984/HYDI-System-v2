/**
 * One-Click Live Authorization Tests
 *
 * Tests the full one-click "Authorize" flow:
 *   1. HYDI stages a transaction (stageLiveAuthorization)
 *   2. The human clicks "Allow" (resolveLiveAuthorization with "approve")
 *   3. ALLOW_LIVE_STRIPE is set to true (operatorOverride)
 *   4. A single-use LiveTransactionAuthorization is issued
 *   5. The audit trail records who/what/when/evidence
 *   6. If 15 minutes pass, the request expires
 *   7. A stale "yes" cannot authorize a later transaction
 *
 * Also verifies:
 *   - The request is scoped (not a global switch)
 *   - The request is single-use
 *   - The request is time-bounded (15-minute expiry)
 *   - The request is amount-bounded and customer-bounded
 *   - The Stripe key is never displayed
 *   - The flow uses the existing HumanActionRequest pattern (AR-xxx IDs)
 *   - Denial and revocation work correctly
 *   - The audit trail captures the evidence bundle link
 */

import { ProductionOperationsControlPlane } from '../../lib/operational/ProductionOperationsControlPlane';
import { ConfigurationControlPlane } from '../../lib/operational/ConfigurationControlPlane';
import { CredentialManager } from '../../lib/operational/CredentialManager';
import { LiveTransactionAuthorizationManager } from '../../lib/revenue/LiveTransactionAuthorization';
import { LiveAuthorizationRequestManager } from '../../lib/operational/LiveAuthorizationRequestManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Test helpers ────────────────────────────────────────────────────────

function createTempEnv(initialConfig: Record<string, string> = {}): { envPath: string; authStore: string; reqStore: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-auth-'));
  const envPath = path.join(tmpDir, '.env.local');
  const authStore = path.join(tmpDir, 'auth-store.json');
  const reqStore = path.join(tmpDir, 'req-store.json');

  const lines = ['NODE_ENV=development', ...Object.entries(initialConfig).map(([k, v]) => `${k}=${v}`)];
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');

  return {
    envPath,
    authStore,
    reqStore,
    cleanup: () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

function buildControlPlane(initialConfig: Record<string, string> = {}): {
  cp: ProductionOperationsControlPlane;
  config: ConfigurationControlPlane;
  authManager: LiveTransactionAuthorizationManager;
  reqManager: LiveAuthorizationRequestManager;
  cleanup: () => void;
} {
  const { envPath, authStore, reqStore, cleanup } = createTempEnv(initialConfig);
  const config = new ConfigurationControlPlane(envPath);
  const authManager = new LiveTransactionAuthorizationManager(authStore);
  const credentials = new CredentialManager();
  const reqManager = new LiveAuthorizationRequestManager(config, authManager, reqStore);
  const cp = new ProductionOperationsControlPlane({ config, credentials, authManager, authRequestManager: reqManager });
  return { cp, config, authManager, reqManager, cleanup };
}

// ─── Section 1: Staging the authorization request ────────────────────────

describe('One-click Authorize: staging', () => {
  test('HYDI stages a request with a human-readable summary', async () => {
    const { cp, cleanup } = buildControlPlane({
      LIVE_QUALIFICATION_CUSTOMER_EMAIL: 'test@example.com',
    });
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(result.success).toBe(true);
      expect(result.request).toBeDefined();
      expect(result.request!.id).toMatch(/^AR-/);
      expect(result.request!.summary).toContain('LIVE STRIPE QUALIFICATION TRANSACTION');
      expect(result.request!.summary).toContain('$29.00');
      expect(result.request!.summary).toContain('test@example.com');
      expect(result.request!.summary).toContain('What was verified');
      expect(result.request!.summary).toContain('What was NOT verified');
    } finally { cleanup(); }
  });

  test('staging does NOT set ALLOW_LIVE_STRIPE', async () => {
    const { cp, config, cleanup } = buildControlPlane();
    try {
      await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(config.read('ALLOW_LIVE_STRIPE')).not.toBe('true');
    } finally { cleanup(); }
  });

  test('staging does NOT issue a transaction authorization', async () => {
    const { cp, authManager, cleanup } = buildControlPlane();
    try {
      await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(authManager.getPending()).toBeNull();
    } finally { cleanup(); }
  });

  test('staging uses the AR-xxx ID format (existing HumanActionRequest pattern)', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(result.request!.id).toMatch(/^AR-[a-f0-9]{8}$/);
    } finally { cleanup(); }
  });

  test('staging includes evidence (what was verified, what wasn\'t)', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(result.request!.evidence).toBeDefined();
      expect(result.request!.evidence.verified).toBeDefined();
      expect(result.request!.evidence.notVerified).toBeDefined();
      expect(result.request!.evidence.preflightState).toBeDefined();
      expect(result.request!.evidence.stripeMode).toBeDefined();
      expect(result.request!.evidence.collectedAt).toBeDefined();
    } finally { cleanup(); }
  });

  test('staging fails without a customer email', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('customer');
    } finally { cleanup(); }
  });

  test('staging fails if a pending request already exists', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const r1 = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(r1.success).toBe(true);

      const r2 = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(r2.success).toBe(false);
      expect(r2.error).toContain('pending');
    } finally { cleanup(); }
  });
});

// ─── Section 2: Approving (the "Allow" click) ────────────────────────────

describe('One-click Authorize: approval', () => {
  test('clicking Allow sets ALLOW_LIVE_STRIPE=true', async () => {
    const { cp, config, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(config.read('ALLOW_LIVE_STRIPE')).not.toBe('true');

      const result = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      expect(result.success).toBe(true);
      expect(config.read('ALLOW_LIVE_STRIPE')).toBe('true');
    } finally { cleanup(); }
  });

  test('clicking Allow issues a single-use LiveTransactionAuthorization', async () => {
    const { cp, authManager, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(authManager.getPending()).toBeNull();

      const result = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      expect(result.success).toBe(true);
      expect(result.transactionAuthorization).toBeDefined();
      expect(result.transactionAuthorization!.state).toBe('PENDING');
      expect(result.transactionAuthorization!.customer).toBe('test@example.com');
      expect(result.transactionAuthorization!.amountCents).toBe(2900);
      expect(authManager.getPending()).not.toBeNull();
    } finally { cleanup(); }
  });

  test('clicking Allow records an audit trail', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      const result = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      expect(result.request!.auditRecord).toBeDefined();
      expect(result.request!.auditRecord!.resolvedBy).toBe('operator@test');
      expect(result.request!.auditRecord!.resolution).toBe('approved');
      expect(result.request!.auditRecord!.resolvedAt).toBeDefined();
      expect(result.request!.auditRecord!.whatWasAuthorized).toContain('$29.00');
      expect(result.request!.auditRecord!.whatWasAuthorized).toContain('test@example.com');
      expect(result.request!.auditRecord!.evidenceBundleId).toBe(stage.request!.id);
      expect(result.request!.auditRecord!.transactionAuthorizationId).toBeDefined();
      expect(result.request!.auditRecord!.resolvedVia).toContain('authorize-live');
    } finally { cleanup(); }
  });

  test('approval is scoped to the specific request ID', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      // Wrong request ID fails
      const wrong = cp.resolveLiveAuthorization({
        requestId: 'AR-wrongid',
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });
      expect(wrong.success).toBe(false);
      expect(wrong.error).toContain('not found');
    } finally { cleanup(); }
  });

  test('approval is single-use — cannot approve the same request twice', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      const r1 = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });
      expect(r1.success).toBe(true);

      const r2 = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });
      expect(r2.success).toBe(false);
      expect(r2.error).toContain('already resolved');
    } finally { cleanup(); }
  });
});

// ─── Section 3: Time-bounded (15-minute expiry) ──────────────────────────

describe('One-click Authorize: time-bounded', () => {
  test('request has a 15-minute expiry', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      const created = new Date(result.request!.createdAt);
      const expires = new Date(result.request!.expiresAt);
      const diffMinutes = (expires.getTime() - created.getTime()) / (60 * 1000);
      expect(diffMinutes).toBeCloseTo(15, 0);
    } finally { cleanup(); }
  });

  test('expired request cannot be approved', async () => {
    const { cp, reqManager, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      // Manually expire the request
      const request = reqManager.get(stage.request!.id);
      if (request) {
        request.expiresAt = new Date(Date.now() - 1000).toISOString(); // expired 1 second ago
      }

      const result = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    } finally { cleanup(); }
  });

  test('a stale "yes" cannot authorize a later transaction', async () => {
    const { cp, reqManager, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      // Expire the request
      const request = reqManager.get(stage.request!.id);
      if (request) {
        request.expiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // expired 1 hour ago
      }

      // Try to approve the stale request
      const result = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
      expect(result.request!.resolution).toBe('expired');
    } finally { cleanup(); }
  });
});

// ─── Section 4: Denial and revocation ────────────────────────────────────

describe('One-click Authorize: denial and revocation', () => {
  test('clicking Deny does NOT set ALLOW_LIVE_STRIPE', async () => {
    const { cp, config, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'deny',
      });

      expect(config.read('ALLOW_LIVE_STRIPE')).not.toBe('true');
    } finally { cleanup(); }
  });

  test('clicking Deny does NOT issue a transaction authorization', async () => {
    const { cp, authManager, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'deny',
      });

      expect(authManager.getPending()).toBeNull();
    } finally { cleanup(); }
  });

  test('denial records an audit trail', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      const result = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'deny',
      });

      expect(result.request!.auditRecord).toBeDefined();
      expect(result.request!.auditRecord!.resolution).toBe('denied');
      expect(result.request!.auditRecord!.whatWasAuthorized).toContain('Nothing');
    } finally { cleanup(); }
  });

  test('revocation cancels a pending request', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });

      const result = cp.revokeLiveAuthorizationRequest(stage.request!.id, 'operator@test');
      expect(result.success).toBe(true);
      expect(result.request!.resolution).toBe('revoked');

      // Cannot approve a revoked request
      const approve = cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });
      expect(approve.success).toBe(false);
    } finally { cleanup(); }
  });
});

// ─── Section 5: Security — no secret exposure ────────────────────────────

describe('One-click Authorize: security', () => {
  test('request never contains a Stripe key value', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      const serialized = JSON.stringify(result.request);
      expect(serialized).not.toMatch(/sk_live_[a-zA-Z0-9]{20,}/);
      expect(serialized).not.toMatch(/sk_test_[a-zA-Z0-9]{20,}/);
      expect(serialized).not.toMatch(/rk_live_[a-zA-Z0-9]{20,}/);
      expect(serialized).not.toMatch(/whsec_[a-zA-Z0-9]{20,}/);
    } finally { cleanup(); }
  });

  test('evidence contains credential metadata, not the value', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      const credHealth = result.request!.evidence.stripeCredentialHealth;
      expect(credHealth).toBeDefined();
      expect(credHealth).not.toHaveProperty('value');
      expect(credHealth).toHaveProperty('configured');
      expect(credHealth).toHaveProperty('mode');
      expect(credHealth).toHaveProperty('valid');
      expect(credHealth).toHaveProperty('prefix');
    } finally { cleanup(); }
  });

  test('summary mentions the key is stored securely and will not be displayed', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      expect(result.request!.summary).toContain('stored securely');
      expect(result.request!.summary).toContain('NOT be displayed');
    } finally { cleanup(); }
  });
});

// ─── Section 6: Audit trail ──────────────────────────────────────────────

describe('One-click Authorize: audit trail', () => {
  test('audit trail captures all resolved requests', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      const trail = cp.getLiveAuthorizationAuditTrail();
      expect(trail.length).toBe(1);
      expect(trail[0].requestId).toBe(stage.request!.id);
      expect(trail[0].resolvedBy).toBe('operator@test');
      expect(trail[0].resolution).toBe('approved');
      expect(trail[0].evidenceBundleId).toBe(stage.request!.id);
    } finally { cleanup(); }
  });

  test('audit trail links to the evidence bundle shown at click time', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const stage = await cp.stageLiveAuthorization({ customer: 'test@example.com' });
      cp.resolveLiveAuthorization({
        requestId: stage.request!.id,
        resolvedBy: 'operator@test',
        resolution: 'approve',
      });

      const trail = cp.getLiveAuthorizationAuditTrail();
      expect(trail[0].evidenceBundleId).toBe(stage.request!.id);

      // The evidence is stored on the request itself
      const request = cp.getLiveAuthorizationRequest(stage.request!.id);
      expect(request!.evidence).toBeDefined();
      expect(request!.evidence.verified).toBeDefined();
      expect(request!.evidence.notVerified).toBeDefined();
    } finally { cleanup(); }
  });
});

// ─── Section 7: Integration with ConfigurationControlPlane enforcement ───

describe('One-click Authorize: structural enforcement', () => {
  test('ALLOW_LIVE_STRIPE cannot be set without operatorOverride', async () => {
    const { config, cleanup } = buildControlPlane();
    try {
      // Without operatorOverride — should fail
      const result = config.set('ALLOW_LIVE_STRIPE', 'true', 'hydi', 'auto-resolve');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not auto-modifiable');
      expect(result.error).toContain('operator override');
    } finally { cleanup(); }
  });

  test('ALLOW_LIVE_STRIPE can be set with operatorOverride (the click)', async () => {
    const { config, cleanup } = buildControlPlane();
    try {
      const result = config.set('ALLOW_LIVE_STRIPE', 'true', 'operator', 'one-click authorize', true);
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
    } finally { cleanup(); }
  });

  test('canAutoModify returns false for ALLOW_LIVE_STRIPE', async () => {
    const { config, cleanup } = buildControlPlane();
    try {
      expect(config.canAutoModify('ALLOW_LIVE_STRIPE')).toBe(false);
    } finally { cleanup(); }
  });

  test('applySafeConfiguration cannot set ALLOW_LIVE_STRIPE (no operatorOverride)', async () => {
    const { cp, cleanup } = buildControlPlane();
    try {
      const result = await cp.applySafeConfiguration('ALLOW_LIVE_STRIPE', 'true', 'test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not auto-modifiable');
    } finally { cleanup(); }
  });
});
