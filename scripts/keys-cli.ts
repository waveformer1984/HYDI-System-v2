#!/usr/bin/env npx tsx
/**
 * HYDI Key Management CLI
 *
 * Usage:
 *   npx tsx scripts/keys-cli.ts list
 *   npx tsx scripts/keys-cli.ts inspect <id>
 *   npx tsx scripts/keys-cli.ts scan
 *   npx tsx scripts/keys-cli.ts health
 *   npx tsx scripts/keys-cli.ts rotate <id> [--dry-run]
 *   npx tsx scripts/keys-cli.ts revoke <id> [--dry-run]
 *   npx tsx scripts/keys-cli.ts reconcile
 *   npx tsx scripts/keys-cli.ts audit [--limit=50]
 *   npx tsx scripts/keys-cli.ts generate <provider> [--dry-run]
 *   npx tsx scripts/keys-cli.ts validate <id>
 *   npx tsx scripts/keys-cli.ts recover <id>
 *   npx tsx scripts/keys-cli.ts compromise <id> --suspicion="reason" [--dry-run]
 *
 * SECURITY: This CLI NEVER displays secret values.
 * Only metadata, fingerprints, and lifecycle states are shown.
 */

import { getKeyManagementService } from '../lib/operational/KeyManagementService';
import { getKeyAuditService } from '../lib/operational/KeyAuditService';
import { SecretScanner } from '../lib/operational/SecretScanner';
import { KeyHealthMonitor } from '../lib/operational/KeyHealthMonitor';
import { KeyCompromiseResponse } from '../lib/operational/KeyCompromiseResponse';

const command = process.argv[2];
const arg = process.argv[3];

function parseFlags(): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 4; i < process.argv.length; i++) {
    const part = process.argv[i];
    const match = part.match(/^--(\w+)=(.+)$/);
    if (match) {
      flags[match[1]] = match[2];
    } else if (part.startsWith('--')) {
      flags[part.slice(2)] = 'true';
    }
  }
  return flags;
}

async function main() {
  if (!command) {
    console.error('Usage: keys-cli.ts <command> [args]');
    console.error('Commands: list, inspect, scan, health, rotate, revoke, reconcile, audit, generate, validate, recover, compromise');
    process.exit(1);
  }

  const kms = getKeyManagementService();

  switch (command) {
    case 'list': {
      const inventory = kms.getInventory();
      console.log('\n=== Key Inventory ===\n');
      console.log(`Total: ${inventory.summary.total}`);
      console.log(`Active: ${inventory.summary.active}`);
      console.log(`Expiring: ${inventory.summary.expiring}`);
      console.log(`Expired: ${inventory.summary.expired}`);
      console.log(`Rotation due: ${inventory.summary.rotationDue}`);
      console.log(`Compromised: ${inventory.summary.compromised}`);
      console.log(`Revoked: ${inventory.summary.revoked}`);
      console.log(`Destroyed: ${inventory.summary.destroyed}`);
      console.log(`\nBy risk: ${JSON.stringify(inventory.summary.byRiskLevel)}`);
      console.log(`By provider: ${JSON.stringify(inventory.summary.byProvider)}`);
      console.log(`\nLast reconciled: ${inventory.lastReconciledAt}`);

      if (inventory.keys.length > 0) {
        console.log('\n--- Keys ---\n');
        for (const key of inventory.keys) {
          console.log(`  ${key.id.slice(0, 8)}  ${key.envVar ?? '(no env var)'}  ${key.provider}  ${key.lifecycleState}  risk=${key.riskLevel}  fp=${key.fingerprint ?? 'null'}`);
        }
      }
      break;
    }

    case 'inspect': {
      if (!arg) {
        console.error('Usage: keys-cli.ts inspect <id>');
        process.exit(1);
      }
      const key = kms.getKey(arg);
      if (!key) {
        console.error(`Key not found: ${arg}`);
        process.exit(1);
      }
      console.log('\n=== Key Details ===\n');
      console.log(JSON.stringify(key, null, 2));
      break;
    }

    case 'scan': {
      console.log('Scanning repository for secrets...');
      const scanner = new SecretScanner(process.cwd());
      const result = await scanner.scan();
      console.log(`\nScanned ${result.scannedFiles} files, ${result.scannedLines} lines in ${result.scanDurationMs}ms`);
      console.log(`Total findings: ${result.findings.length}`);
      console.log(`New (non-allowlisted): ${result.newFindingsCount}`);
      console.log(`Allowlisted: ${result.allowlistedCount}`);

      if (result.newFindingsCount > 0) {
        console.log('\n--- New Findings ---\n');
        for (const finding of result.findings.filter(f => !f.allowlisted)) {
          console.log(`  ${finding.filePath}:${finding.lineNumber}  ${finding.patternType}  ${finding.redactedPreview}  confidence=${finding.confidence}`);
          console.log(`    ${finding.description}`);
        }
      }
      break;
    }

    case 'health': {
      const scanner = new SecretScanner(process.cwd());
      const monitor = new KeyHealthMonitor(kms, scanner);
      const result = await monitor.checkAll();
      console.log('\n=== Key Health ===\n');
      console.log(`Total: ${result.summary.total}`);
      console.log(`Healthy: ${result.summary.healthy}`);
      console.log(`With findings: ${result.summary.withFindings}`);
      console.log(`Critical: ${result.summary.critical}`);
      console.log(`Warning: ${result.summary.warning}`);

      if (result.summary.withFindings > 0) {
        console.log('\n--- Findings ---\n');
        for (const status of result.statuses) {
          if (!status.healthy) {
            console.log(`  Key ${status.keyId.slice(0, 8)}:`);
            for (const finding of status.findings) {
              console.log(`    [${finding.severity}] ${finding.type}: ${finding.description}`);
              console.log(`      Action: ${finding.recommendedAction}`);
            }
          }
        }
      }
      break;
    }

    case 'rotate': {
      if (!arg) {
        console.error('Usage: keys-cli.ts rotate <id> [--dry-run]');
        process.exit(1);
      }
      const flags = parseFlags();
      const dryRun = flags['dry-run'] === 'true';
      if (dryRun) {
        const key = kms.getKey(arg);
        if (!key) {
          console.error(`Key not found: ${arg}`);
          process.exit(1);
        }
        console.log(`\n=== Dry Run: Rotate ${key.envVar ?? arg} ===\n`);
        console.log(`Provider: ${key.provider}`);
        console.log(`Current state: ${key.lifecycleState}`);
        console.log(`Risk level: ${key.riskLevel}`);
        console.log(`Fingerprint: ${key.fingerprint ?? 'null'}`);
        console.log(`\nWould: create replacement key, validate it, provision it, disable old key, deprecate old key`);
        console.log(`No changes will be made.`);
        break;
      }
      console.log(`Rotating key ${arg}...`);
      const result = await kms.rotate(arg);
      console.log(`\nSuccess: ${result.success}`);
      console.log(`Message: ${result.message}`);
      if (result.failureReason) console.log(`Failure: ${result.failureReason}`);
      break;
    }

    case 'revoke': {
      if (!arg) {
        console.error('Usage: keys-cli.ts revoke <id> [--dry-run]');
        process.exit(1);
      }
      const flags = parseFlags();
      const dryRun = flags['dry-run'] === 'true';
      if (dryRun) {
        const key = kms.getKey(arg);
        if (!key) {
          console.error(`Key not found: ${arg}`);
          process.exit(1);
        }
        console.log(`\n=== Dry Run: Revoke ${key.envVar ?? arg} ===\n`);
        console.log(`Provider: ${key.provider}`);
        console.log(`Current state: ${key.lifecycleState}`);
        console.log(`\nWould: call provider.revoke(), mark as REVOKED, delete from vault`);
        console.log(`No changes will be made.`);
        break;
      }
      console.log(`Revoking key ${arg}...`);
      const result = await kms.revoke(arg);
      console.log(`\nSuccess: ${result.success}`);
      console.log(`Message: ${result.message}`);
      break;
    }

    case 'reconcile': {
      console.log('Reconciling inventory with environment...');
      const result = await kms.discover();
      console.log(`\nAdded: ${result.added.length}`);
      console.log(`Updated: ${result.updated.length}`);
      console.log(`Removed: ${result.removed.length}`);
      break;
    }

    case 'audit': {
      const flags = parseFlags();
      const limit = parseInt(flags.limit ?? '50', 10);
      const audit = getKeyAuditService();
      const records = audit.getRecent(limit);
      console.log(`\n=== Key Audit Trail (${records.length} records) ===\n`);
      for (const record of records) {
        console.log(`  ${record.timestamp}  ${record.operation}  ${record.keyIdentifier}  ${record.decision}  ${record.resultingState}`);
      }
      break;
    }

    case 'generate': {
      if (!arg) {
        console.error('Usage: keys-cli.ts generate <provider> [--dry-run]');
        process.exit(1);
      }
      const flags = parseFlags();
      const dryRun = flags['dry-run'] === 'true';
      console.log(`Generating ${arg} key${dryRun ? ' (dry-run)' : ''}...`);
      const result = await kms.generate(arg, {
        credentialType: 'api_key',
        scopes: [],
        description: `Generated by CLI at ${new Date().toISOString()}`,
        dryRun,
      });
      console.log(`\nSuccess: ${result.success}`);
      console.log(`Message: ${result.message}`);
      if (result.failureReason) console.log(`Failure: ${result.failureReason}`);
      break;
    }

    case 'validate': {
      if (!arg) {
        console.error('Usage: keys-cli.ts validate <id>');
        process.exit(1);
      }
      console.log(`Validating key ${arg}...`);
      const result = await kms.validate(arg);
      console.log(`\nSuccess: ${result.success}`);
      console.log(`Validation: ${result.validationResult}`);
      console.log(`Message: ${result.message}`);
      break;
    }

    case 'recover': {
      if (!arg) {
        console.error('Usage: keys-cli.ts recover <id>');
        process.exit(1);
      }
      console.log(`Recovering key ${arg}...`);
      const result = await kms.recover(arg);
      console.log(`\nSuccess: ${result.success}`);
      console.log(`Message: ${result.message}`);
      break;
    }

    case 'compromise': {
      if (!arg) {
        console.error('Usage: keys-cli.ts compromise <id> --suspicion="reason" [--dry-run]');
        process.exit(1);
      }
      const flags = parseFlags();
      const suspicion = flags.suspicion ?? 'Suspected compromise';
      const dryRun = flags['dry-run'] === 'true';
      if (dryRun) {
        const key = kms.getKey(arg);
        if (!key) {
          console.error(`Key not found: ${arg}`);
          process.exit(1);
        }
        console.log(`\n=== Dry Run: Compromise Response for ${key.envVar ?? arg} ===\n`);
        console.log(`Provider: ${key.provider}`);
        console.log(`Current state: ${key.lifecycleState}`);
        console.log(`Suspicion: ${suspicion}`);
        console.log(`\nWould: isolate, revoke, replace, provision, verify, scan for residual exposure`);
        console.log(`No changes will be made.`);
        break;
      }
      console.log(`Executing compromise response for key ${arg}...`);
      const compromiseResponse = new KeyCompromiseResponse(kms);
      const result = await compromiseResponse.respond(arg, suspicion);
      console.log(`\nSuccess: ${result.success}`);
      console.log(`Isolated: ${result.isolated}`);
      console.log(`Revoked: ${result.revoked}`);
      console.log(`Replaced: ${result.replaced}`);
      console.log(`Verified: ${result.verified}`);
      console.log(`Message: ${result.message}`);
      if (result.escalationRequired) console.log('ESCALATION REQUIRED — human authorization needed');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
