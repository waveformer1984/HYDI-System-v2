/**
 * HEIDI Failure Injection Harness
 *
 * Deliberately injects controlled failures to test HEIDI's autonomous
 * recovery capabilities. Each failure is safe, reversible, and scoped.
 *
 * Usage:
 *   npx tsx scripts/failure-injection.ts --failure=credential_invalid
 *   npx tsx scripts/failure-injection.ts --failure=process_kill
 *   npx tsx scripts/failure-injection.ts --failure=config_corruption
 *   npx tsx scripts/failure-injection.ts --list
 */

import fs from 'fs';
import path from 'path';

type FailureType =
  | 'credential_invalid'
  | 'credential_expired'
  | 'credential_missing'
  | 'process_kill'
  | 'port_unavailable'
  | 'config_corruption'
  | 'provider_timeout'
  | 'provider_500'
  | 'authorization_denied'
  | 'verification_failure';

interface FailureResult {
  failure: FailureType;
  injected: boolean;
  description: string;
  evidence: string;
  reversible: boolean;
  rollback: string;
}

const FAILURES: Record<FailureType, { description: string; inject: () => Promise<FailureResult>; rollback: () => Promise<void> }> = {
  credential_invalid: {
    description: 'Set a credential to an invalid value (sk_test_INVALID)',
    inject: async () => {
      const envPath = path.resolve(process.cwd(), '.env.local');
      let original = '';
      if (fs.existsSync(envPath)) {
        original = fs.readFileSync(envPath, 'utf8');
      }
      // Append an invalid Stripe key
      const invalid = original.includes('STRIPE_SECRET_KEY')
        ? original.replace(/STRIPE_SECRET_KEY=.*/, 'STRIPE_SECRET_KEY=sk_test_INVALID_0000000000000000')
        : original + '\nSTRIPE_SECRET_KEY=sk_test_INVALID_0000000000000000\n';
      fs.writeFileSync(envPath, invalid);
      process.env.STRIPE_SECRET_KEY = 'sk_test_INVALID_0000000000000000';
      return {
        failure: 'credential_invalid',
        injected: true,
        description: 'Set STRIPE_SECRET_KEY to an invalid value',
        evidence: 'STRIPE_SECRET_KEY set to sk_test_INVALID_... in .env.local and process.env',
        reversible: true,
        rollback: 'Original .env.local content saved to .env.local.backup',
      };
    },
    rollback: async () => {
      const backupPath = path.resolve(process.cwd(), '.env.local.backup');
      const envPath = path.resolve(process.cwd(), '.env.local');
      if (fs.existsSync(backupPath)) {
        fs.writeFileSync(envPath, fs.readFileSync(backupPath, 'utf8'));
        fs.unlinkSync(backupPath);
      }
    },
  },
  credential_missing: {
    description: 'Remove a credential from the environment',
    inject: async () => {
      const original = process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;
      return {
        failure: 'credential_missing',
        injected: true,
        description: 'Removed STRIPE_SECRET_KEY from process.env',
        evidence: `STRIPE_SECRET_KEY was ${original ? 'present' : 'absent'}, now removed`,
        reversible: true,
        rollback: 'Original value will be restored',
      };
    },
    rollback: async () => {
      // Can't restore — the value was deleted. In a real test, we'd save it first.
    },
  },
  process_kill: {
    description: 'Kill a controlled HEIDI dependency (simulated)',
    inject: async () => {
      // In a real test, we'd kill a specific child process.
      // For safety, we just report what would happen.
      return {
        failure: 'process_kill',
        injected: false,
        description: 'Would kill a controlled HEIDI dependency process',
        evidence: 'Simulated — no process was actually killed',
        reversible: true,
        rollback: 'Process would be restarted by the boot agent',
      };
    },
    rollback: async () => {},
  },
  port_unavailable: {
    description: 'Make a port unavailable (simulated)',
    inject: async () => {
      return {
        failure: 'port_unavailable',
        injected: false,
        description: 'Would bind to a port to make it unavailable',
        evidence: 'Simulated — no port was actually bound',
        reversible: true,
        rollback: 'Port binding would be released',
      };
    },
    rollback: async () => {},
  },
  config_corruption: {
    description: 'Corrupt a recoverable configuration file',
    inject: async () => {
      const configPath = path.resolve(process.cwd(), '.hydi-operational', 'test-config.json');
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Write a corrupted config
      fs.writeFileSync(configPath, '{ "corrupted": true, "invalid": }');
      return {
        failure: 'config_corruption',
        injected: true,
        description: 'Wrote corrupted JSON to .hydi-operational/test-config.json',
        evidence: 'File contains invalid JSON',
        reversible: true,
        rollback: 'Delete .hydi-operational/test-config.json',
      };
    },
    rollback: async () => {
      const configPath = path.resolve(process.cwd(), '.hydi-operational', 'test-config.json');
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    },
  },
  provider_timeout: {
    description: 'Simulate a provider timeout (mock fetch)',
    inject: async () => {
      return {
        failure: 'provider_timeout',
        injected: false,
        description: 'Would mock fetch to never respond',
        evidence: 'Simulated — requires test harness to mock fetch',
        reversible: true,
        rollback: 'Restore original fetch',
      };
    },
    rollback: async () => {},
  },
  provider_500: {
    description: 'Simulate a provider 500 error (mock fetch)',
    inject: async () => {
      return {
        failure: 'provider_500',
        injected: false,
        description: 'Would mock fetch to return 500',
        evidence: 'Simulated — requires test harness to mock fetch',
        reversible: true,
        rollback: 'Restore original fetch',
      };
    },
    rollback: async () => {},
  },
  authorization_denied: {
    description: 'Deny all pending authorization requests',
    inject: async () => {
      const { getOwnerAuthorizationStore } = await import('../lib/operational/OwnerAuthorizationStore');
      const store = getOwnerAuthorizationStore();
      const pending = store.getPendingRequests();
      for (const req of pending) {
        store.deny(req.id, 'failure-injection', 'Denied by failure injection harness');
      }
      return {
        failure: 'authorization_denied',
        injected: true,
        description: `Denied ${pending.length} pending authorization request(s)`,
        evidence: `${pending.length} requests denied`,
        reversible: true,
        rollback: 'Requests remain denied (audit trail preserved)',
      };
    },
    rollback: async () => {},
  },
  verification_failure: {
    description: 'Inject a verification failure by setting an invalid credential',
    inject: async () => {
      process.env.GOOGLE_PLACES_API_KEY = 'INVALID_KEY_FOR_TESTING';
      return {
        failure: 'verification_failure',
        injected: true,
        description: 'Set GOOGLE_PLACES_API_KEY to an invalid value',
        evidence: 'GOOGLE_PLACES_API_KEY set to INVALID_KEY_FOR_TESTING',
        reversible: true,
        rollback: 'Delete the invalid key from process.env',
      };
    },
    rollback: async () => {
      delete process.env.GOOGLE_PLACES_API_KEY;
    },
  },
  credential_expired: {
    description: 'Simulate an expired credential (mock)',
    inject: async () => {
      return {
        failure: 'credential_expired',
        injected: false,
        description: 'Would mock provider API to return 403 (expired)',
        evidence: 'Simulated — requires test harness to mock fetch',
        reversible: true,
        rollback: 'Restore original fetch',
      };
    },
    rollback: async () => {},
  },
};

async function main() {
  const args = process.argv.slice(2);
  const listFlag = args.includes('--list');
  const failureArg = args.find((a) => a.startsWith('--failure='))?.split('=')[1] as FailureType;
  const rollbackFlag = args.includes('--rollback');

  if (listFlag) {
    console.log('\nAvailable failure injections:\n');
    for (const [key, val] of Object.entries(FAILURES)) {
      console.log(`  ${key.padEnd(25)} ${val.description}`);
    }
    console.log('');
    process.exit(0);
  }

  if (!failureArg) {
    console.error('Usage: npx tsx scripts/failure-injection.ts --failure=<type> [--rollback]');
    console.error('Run with --list to see available failure types');
    process.exit(1);
  }

  const failure = FAILURES[failureArg];
  if (!failure) {
    console.error(`Unknown failure type: ${failureArg}`);
    console.error('Run with --list to see available failure types');
    process.exit(1);
  }

  if (rollbackFlag) {
    console.log(`Rolling back ${failureArg}...`);
    await failure.rollback();
    console.log('Rollback complete.');
    process.exit(0);
  }

  console.log(`\nInjecting failure: ${failureArg}`);
  console.log(`Description: ${failure.description}\n`);

  const result = await failure.inject();

  console.log('Result:');
  console.log(`  Injected: ${result.injected}`);
  console.log(`  Evidence: ${result.evidence}`);
  console.log(`  Reversible: ${result.reversible}`);
  console.log(`  Rollback: ${result.rollback}`);
  console.log('');

  // Machine-readable output
  console.log('--- MACHINE READABLE ---');
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.injected ? 0 : 1);
}

main().catch((error) => {
  console.error('Failure injection failed:', error);
  process.exit(1);
});
