/**
 * Self-development boundary dry-run (R2 contract item 13).
 *
 * Before self-development can ever be enabled, the development system must be
 * able to make a harmless change inside an approved workspace while being
 * structurally incapable of modifying:
 *   1. governance code            (lib/governance, policy-engine, action-gate)
 *   2. verification code          (tests/, jest config, boot-control)
 *   3. protected runtime          (boot-agent, ecosystem config, package.json)
 *   4. evidence / history         (.hydi-operational, recovery-leases)
 *   5. its own test               (tests/**)
 *   6. its own authorization      (FilesystemAuthorization, HumanActionEngine)
 *   7. its own protection rules   (this file's PROTECTED_PATTERNS source)
 *
 * This exercises authorizeFilesystemTarget directly — the boundary the dev
 * adapter and any self-development path must go through.
 */

import { authorizeFilesystemTarget, FILESYSTEM_WRITABLE_ZONES } from '../../lib/human-action/FilesystemAuthorization';
import path from 'path';

const repoRoot = process.cwd();
const opts = { repoRoot, allowedTargets: FILESYSTEM_WRITABLE_ZONES };

function allow(target: string, op: 'read' | 'write' = 'write') {
  return authorizeFilesystemTarget(target, { ...opts, operation: op });
}

describe('self-development dry-run — the approved workspace change proceeds', () => {
  test.each([
    'hydi-workspace/notes.md',
    'hydi-workspace/feature/impl.ts',
    'test-project/scaffold/index.ts',
    'artifacts/customer-jobs/job-1/output.json',
    'docs/mission-reviews/review-1.md',
    'reports/briefing-1.md',
  ])('write to %s is permitted', (t) => {
    const d = allow(t);
    expect(d.allowed).toBe(true);
  });
});

describe('self-development dry-run — protected modifications are denied', () => {
  const PROTECTED: Array<[string, string]> = [
    ['lib/governance/ActionChokepoint.ts', 'governance'],
    ['lib/protoforge/policy-engine.js', 'governance (policy engine)'],
    ['lib/protoforge/action-gate.ts', 'governance (action gate)'],
    ['lib/action-approval.ts', 'authorization'],
    ['lib/human-action/FilesystemAuthorization.ts', 'its own protection rules'],
    ['lib/human-action/HumanActionEngine.ts', 'its own authorization engine'],
    ['lib/operational/RecoveryEngine.ts', 'protected runtime (recovery)'],
    ['evolution/planner.ts', 'self-development machinery'],
    ['tests/unit/self-development-boundary.test.ts', 'its own test'],
    ['tests/unit/action-chokepoint.test.ts', 'verification code'],
    ['jest.config.js', 'verification config'],
    ['scripts/boot-control.js', 'protected runtime (boot control)'],
    ['scripts/boot-agent.js', 'protected runtime (boot agent)'],
    ['package.json', 'protected config'],
    ['ecosystem.config.js', 'protected runtime config'],
    ['.hydi-operational/ledger.json', 'evidence'],
    ['.recovery-leases/lease-1', 'evidence (lease)'],
    ['HYDI_BASELINE.json', 'evidence (baseline)'],
    ['.env', 'secret'],
    ['.env.production', 'secret (variant)'],
    ['src/server.ts', 'production source (not a writable zone)'],
    ['api/chat/route.js', 'production source (not a writable zone)'],
    ['lib/action-executor.ts', 'production source (not a writable zone)'],
  ];

  for (const [t, label] of PROTECTED) {
    test(`write to ${label}: ${t} is denied`, () => {
      const d = allow(t);
      expect(d.allowed).toBe(false);
      expect(['PROTECTED_PATH', 'NOT_IN_ALLOWED_TARGETS', 'TRAVERSAL_DENIED']).toContain(d.code);
    });
  }
});

describe('self-development dry-run — evasion attempts are denied', () => {
  test.each([
    ['.ENV', 'case variant of .env'],
    ['.Env', 'mixed-case .env'],
    ['LIB/GOVERNANCE/ActionChokepoint.ts', 'uppercase governance path'],
    ['TESTS/unit/x.test.ts', 'uppercase test path'],
    ['lib/governance/../governance/x.ts', 'normalised protected path'],
    ['lib\\governance\\ActionChokepoint.ts', 'alternate separators'],
    ['hydi-workspace/../../.env', 'traversal to a secret'],
    ['hydi-workspace/../../lib/action-executor.ts', 'traversal to source'],
    ['../outside-repo.txt', 'traversal outside repo'],
    ['C:/Windows/system.ini', 'absolute path outside repo'],
    ['.git/config', 'VCS internals'],
  ])('%s (%s) is denied', (t) => {
    const d = allow(t);
    expect(d.allowed).toBe(false);
  });
});

describe('self-development dry-run — protected reads are denied too', () => {
  // A read-capable capability declares its own read-targets (not the write
  // zones). Even with source readable, secrets/VCS stay denied — protection is
  // checked before the allowlist.
  const readOpts = { repoRoot, allowedTargets: [{ type: 'glob', pattern: 'lib/**' }] };

  test.each(['.env', '.env.local', 'id_rsa', '.git/config', 'credentials'])(
    'read of secret %s is denied even when source is readable',
    (t) => {
      const d = authorizeFilesystemTarget(t, { ...readOpts, operation: 'read' });
      expect(d.allowed).toBe(false);
    },
  );

  test('read of ordinary source IS allowed by a read-scoped capability', () => {
    const d = authorizeFilesystemTarget('lib/orchestrator.ts', { ...readOpts, operation: 'read' });
    expect(d.allowed).toBe(true);
  });
});
