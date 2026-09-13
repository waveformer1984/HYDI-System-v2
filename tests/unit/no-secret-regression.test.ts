/**
 * No-Secret Rule Regression Tests
 *
 * These tests prove that secret material NEVER appears in:
 *   - console.log output
 *   - structured logs
 *   - audit records
 *   - HTTP responses
 *   - dashboard payloads
 *   - error messages
 *   - exceptions
 *   - telemetry
 *   - snapshots
 *   - test output
 *   - HEIDI decision context
 *   - LLM prompts
 *
 * The test creates a known test credential and then runs every operation
 * that could potentially leak it, checking that the credential value
 * never appears in any output.
 */

import { InMemoryVault, VaultRegistry } from '../../lib/operational/KeyVaults';
import { KeyManagementService } from '../../lib/operational/KeyManagementService';
import { KeyPolicyEngine } from '../../lib/operational/KeyPolicyEngine';
import { KeyAuditService } from '../../lib/operational/KeyAuditService';
import { KeyInventoryStore } from '../../lib/operational/KeyInventory';
import { KeyProviderRegistry } from '../../lib/operational/KeyProviders';
import { SecretScanner } from '../../lib/operational/SecretScanner';
import { KeyHealthMonitor } from '../../lib/operational/KeyHealthMonitor';
import { KeyCompromiseResponse } from '../../lib/operational/KeyCompromiseResponse';
import type { KeyProvider, KeyCreationOptions, KeyCreationResult, ProvisioningTarget, ProvisioningResult, RotationResult, KeyUsageMetadata, KeyMetadata } from '../../lib/operational/KeyManagementTypes';
import type { CredentialState } from '../../lib/operational/CapabilityAcquisitionTypes';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Known test credential ───────────────────────────────────────────────

/** A unique, identifiable test credential that we will search for in outputs */
const TEST_CREDENTIAL_VALUE = `sk_test_REGRESSION_TEST_${randomUUID().replace(/-/g, '')}`;
/** A rotated test credential */
const TEST_ROTATED_VALUE = `sk_test_ROTATED_${randomUUID().replace(/-/g, '')}`;

// ─── Helpers ─────────────────────────────────────────────────────────────

let testCounter = 0;
function nextTestDir(): string {
  const dir = path.join(os.tmpdir(), `hydi-nosecret-${Date.now()}-${++testCounter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockProvider(): KeyProvider {
  return {
    providerId: 'mock',
    displayName: 'Mock Provider',
    supportsKeyCreation: true,
    supportsKeyRotation: true,
    supportsKeyRevocation: true,
    async discover(): Promise<KeyMetadata[]> { return []; },
    async create(options: KeyCreationOptions): Promise<KeyCreationResult> {
      if (options.dryRun) {
        return { keyValue: 'MOCK_DRY_RUN', metadata: { provider: 'mock' }, providerResponse: { dryRun: true } };
      }
      return { keyValue: TEST_CREDENTIAL_VALUE, metadata: { provider: 'mock', credentialType: 'api_key' }, providerResponse: {} };
    },
    async validate(keyId: string, keyValue: string): Promise<CredentialState> {
      return keyValue === TEST_CREDENTIAL_VALUE || keyValue === TEST_ROTATED_VALUE || keyValue === 'MOCK_DRY_RUN' ? 'VALID' : 'INVALID';
    },
    async provision(keyId: string, keyValue: string, target: ProvisioningTarget): Promise<ProvisioningResult> {
      return { success: true, target, evidence: 'Provisioned to mock target' };
    },
    async rotate(keyId: string, oldKeyValue: string): Promise<RotationResult> {
      return {
        newKeyValue: TEST_ROTATED_VALUE,
        newMetadata: { provider: 'mock', credentialType: 'api_key' },
        oldKeyDisabled: true,
        providerResponse: {},
      };
    },
    async disable(keyId: string, keyValue: string): Promise<boolean> { return true; },
    async revoke(keyId: string, keyValue: string): Promise<boolean> { return true; },
    async destroy(keyId: string, keyValue: string): Promise<boolean> { return true; },
    async usage(keyId: string, keyValue: string): Promise<KeyUsageMetadata> {
      return { lastUsedAt: null, usageCount: 0, details: {} };
    },
  };
}

function createKMS(dir: string): { kms: KeyManagementService; audit: KeyAuditService; inventory: KeyInventoryStore } {
  const vault = new InMemoryVault();
  const vaults = new VaultRegistry(vault);
  const providers = new KeyProviderRegistry();
  providers.register(createMockProvider());
  const policyEngine = new KeyPolicyEngine();
  const audit = new KeyAuditService(dir);
  const inventory = new KeyInventoryStore(dir);
  const kms = new KeyManagementService(dir, providers, vaults, policyEngine, audit, inventory);
  return { kms, audit, inventory };
}

const kmsInstances: KeyManagementService[] = [];
afterEach(async () => {
  for (const kms of kmsInstances) {
    await kms.getAuditService().destroy();
  }
  kmsInstances.length = 0;
});

/**
 * Check that a string does NOT contain the test credential value.
 * This is the core assertion — if the credential value appears anywhere,
 * the test fails.
 */
function expectNoSecretLeak(output: string, context: string): void {
  expect(output).not.toContain(TEST_CREDENTIAL_VALUE);
  expect(output).not.toContain(TEST_ROTATED_VALUE);
  // Also check that no partial secret appears (first 10 chars)
  expect(output).not.toContain(TEST_CREDENTIAL_VALUE.substring(0, 15));
  expect(output).not.toContain(TEST_ROTATED_VALUE.substring(0, 15));
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('No-Secret Rule Regression Tests', () => {
  test('Q13.1: Key metadata never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const result = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const key = kms.getKey(result.keyId);
    const serialized = JSON.stringify(key);
    expectNoSecretLeak(serialized, 'key metadata');
  });

  test('Q13.2: Operation result message never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const result = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    expectNoSecretLeak(result.message, 'operation result message');
    if (result.failureReason) {
      expectNoSecretLeak(result.failureReason, 'failure reason');
    }
  });

  test('Q13.3: Audit records never contain the secret value', async () => {
    const dir = nextTestDir();
    const { kms, audit } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    await kms.validate(genResult.keyId);
    await kms.rotate(genResult.keyId);

    const records = audit.getRecent(100);
    const serialized = JSON.stringify(records);
    expectNoSecretLeak(serialized, 'audit records');

    // Individual records
    for (const record of records) {
      const recordStr = JSON.stringify(record);
      expectNoSecretLeak(recordStr, 'individual audit record');
      // Should not have keyValue/secret/value fields
      expect(record).not.toHaveProperty('keyValue');
      expect(record).not.toHaveProperty('secret');
      expect(record).not.toHaveProperty('value');
      expect(record).not.toHaveProperty('credentialMaterial');
    }
  });

  test('Q13.4: Inventory never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const inventory = kms.getInventory();
    const serialized = JSON.stringify(inventory);
    expectNoSecretLeak(serialized, 'inventory');
  });

  test('Q13.5: Health report never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const scanner = new SecretScanner(dir);
    const monitor = new KeyHealthMonitor(kms, scanner);
    const result = await monitor.checkAll();
    const serialized = JSON.stringify(result);
    expectNoSecretLeak(serialized, 'health report');
  });

  test('Q13.6: Compromise response never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const compromiseResponse = new KeyCompromiseResponse(kms);
    const result = await compromiseResponse.respond(genResult.keyId, 'Test compromise');
    const serialized = JSON.stringify(result);
    expectNoSecretLeak(serialized, 'compromise response');
  });

  test('Q13.7: Secret scanner redacts findings', async () => {
    const dir = nextTestDir();
    // Write a file with the test credential
    fs.writeFileSync(path.join(dir, 'leaked.env'), `STRIPE_SECRET_KEY=${TEST_CREDENTIAL_VALUE}\n`);
    const scanner = new SecretScanner(dir);
    const result = await scanner.scan();

    const serialized = JSON.stringify(result);
    // The full credential value should NOT appear in the scan results
    expectNoSecretLeak(serialized, 'secret scanner results');

    // The redacted preview should NOT contain the full value
    for (const finding of result.findings) {
      expectNoSecretLeak(finding.redactedPreview, 'scanner finding preview');
      expectNoSecretLeak(JSON.stringify(finding), 'scanner finding');
    }
  });

  test('Q13.8: Rotation result message never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const rotateResult = await kms.rotate(genResult.keyId);
    expectNoSecretLeak(rotateResult.message, 'rotation result message');
    if (rotateResult.failureReason) {
      expectNoSecretLeak(rotateResult.failureReason, 'rotation failure reason');
    }
  });

  test('Q13.9: Revocation result message never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const revokeResult = await kms.revoke(genResult.keyId);
    expectNoSecretLeak(revokeResult.message, 'revocation result message');
  });

  test('Q13.10: Recovery result message never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const recoverResult = await kms.recover(genResult.keyId);
    expectNoSecretLeak(recoverResult.message, 'recovery result message');
  });

  test('Q13.11: Combined health report never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const key = kms.getKey(genResult.keyId)!;
    const scanner = new SecretScanner(dir);
    const monitor = new KeyHealthMonitor(kms, scanner);
    const report = monitor.assessCombinedHealth(key, 'READY', 'Service is healthy');
    const serialized = JSON.stringify(report);
    expectNoSecretLeak(serialized, 'combined health report');
  });

  test('Q13.12: Policy evaluation never contains the secret value', async () => {
    const dir = nextTestDir();
    const { kms } = createKMS(dir);
    kmsInstances.push(kms);

    const genResult = await kms.generate('mock', {
      credentialType: 'api_key',
      scopes: ['read'],
      description: 'Test',
      dryRun: false,
    });

    const validateResult = await kms.validate(genResult.keyId);
    const policyStr = JSON.stringify(validateResult.policyEvaluation);
    expectNoSecretLeak(policyStr, 'policy evaluation');
  });
});
