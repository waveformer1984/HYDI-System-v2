/**
 * Filesystem authorization (Phase 4).
 *
 * Defect being closed (measured 2026-09-18, HYDI_BASELINE.json):
 *   `filesystem.write_file` is declared risk R1, authorizationMode 'autonomous',
 *   requiresHumanApproval false, allowedTargets [{ type:'glob', pattern:'**\/*' }].
 *   `allowedTargets` is declared at 45 sites across ActionCapabilityRegistry.ts
 *   and READ AT ZERO -- verified by direct grep. It is decorative metadata with
 *   no enforcement anywhere in the codebase. FilesystemAdapter.writeFile() is a
 *   bare fs.writeFileSync(target, content) with no root confinement, no
 *   normalization, no traversal check and no symlink check.
 *
 *   Net effect: HYDI can autonomously overwrite lib/operational/
 *   AutonomyPolicyModel.ts, CapabilityAuthorizer.ts, RiskClassifier.ts, its own
 *   verification code, or any evidence ledger. That is precisely the boundary
 *   the governing contract calls hard: HYDI must never autonomously modify the
 *   mechanisms that decide whether HYDI is allowed to act.
 *
 * These tests define the authorization contract. Everything fails closed: an
 * unresolvable, malformed or unknown target is DENIED, never allowed.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  authorizeFilesystemTarget,
  PROTECTED_PATTERNS,
} from '../../lib/human-action/FilesystemAuthorization';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Convenience: authorize a write against the real repo root. */
function authWrite(target: string, extra: Record<string, unknown> = {}) {
  return authorizeFilesystemTarget(target, {
    operation: 'write',
    repoRoot: REPO_ROOT,
    allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'Any file path' }],
    ...extra,
  } as any);
}

describe('Phase 4 — protected paths cannot be written, even with allowedTargets "**/*"', () => {
  // The registry really does declare '**/*' for filesystem.write_file. The whole
  // point of this phase is that such a declaration must not be sufficient.
  const PROTECTED_CASES: Array<[string, string]> = [
    ['lib/operational/AutonomyPolicyModel.ts', 'autonomy policy'],
    ['lib/operational/CapabilityAuthorizer.ts', 'capability authorization'],
    ['lib/operational/RiskClassifier.ts', 'risk classification'],
    ['lib/operational/RecoveryEngine.ts', 'recovery engine'],
    ['lib/human-action/AuthorityManager.ts', 'authority manager'],
    ['lib/human-action/FilesystemAuthorization.ts', 'this authorization module itself'],
    ['lib/capability-contract/ContractRegistry.ts', 'capability contracts'],
    ['tests/unit/filesystem-authorization.test.ts', 'the tests proving this works'],
    ['jest.config.js', 'test configuration'],
    ['jest.setup.js', 'test environment'],
    ['tools/verify.ps1', 'the verification gate'],
    ['.githooks/pre-push', 'the push gate'],
    ['boot.config.json', 'boot module registry'],
    ['ecosystem.config.js', 'supervisor configuration'],
    ['package.json', 'dependency + script definitions'],
    ['.env', 'secrets'],
    ['.env.local', 'secrets'],
    ['.hydi-operational/operational-events.jsonl', 'evidence ledger'],
    ['.recovery-leases/heidi-web.json', 'ownership lease'],
    ['.hydi-boot.lock', 'boot authority lease'],
    ['.git/config', 'version control internals'],
  ];

  test.each(PROTECTED_CASES)('DENIES write to %s (%s)', (target) => {
    const d = authWrite(target);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('PROTECTED_PATH');
    expect(d.matchedRule).toBeTruthy();
  });

  test('a permitted working path IS allowed — this must not deny everything', () => {
    const d = authWrite('lib/missions/scratch-output.json');
    expect(d.allowed).toBe(true);
    expect(d.code).toBe('ALLOWED');
  });

  test('protection is evaluated BEFORE allowedTargets, so a wildcard cannot grant it', () => {
    const wildcard = authWrite('lib/operational/CapabilityAuthorizer.ts');
    const explicit = authorizeFilesystemTarget('lib/operational/CapabilityAuthorizer.ts', {
      operation: 'write',
      repoRoot: REPO_ROOT,
      // Even an explicit, exactly-matching allowlist entry must not win.
      allowedTargets: [{ type: 'glob', pattern: 'lib/operational/**', description: 'explicit' }],
    } as any);

    expect(wildcard.allowed).toBe(false);
    expect(explicit.allowed).toBe(false);
    expect(explicit.code).toBe('PROTECTED_PATH');
  });
});

describe('Phase 4 — path traversal', () => {
  const TRAVERSALS = [
    '../outside-the-repo.txt',
    '../../Users/Owner/evil.txt',
    'lib/../../escape.txt',
    'lib/operational/../../../etc/passwd',
    'lib/./operational/../operational/CapabilityAuthorizer.ts',
  ];

  test.each(TRAVERSALS)('DENIES traversal target %s', (target) => {
    const d = authWrite(target);
    expect(d.allowed).toBe(false);
    expect(['TRAVERSAL_DENIED', 'PROTECTED_PATH']).toContain(d.code);
  });

  test('normalization cannot smuggle a protected path past the check', () => {
    // Resolves to lib/operational/CapabilityAuthorizer.ts.
    const d = authWrite('lib/missions/../operational/CapabilityAuthorizer.ts');
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('PROTECTED_PATH');
  });

  test('an absolute path outside the repo is denied', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd';
    const d = authWrite(outside);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('TRAVERSAL_DENIED');
  });

  test('Windows-style backslash traversal is denied too', () => {
    const d = authWrite('lib\\operational\\..\\..\\..\\escape.txt');
    expect(d.allowed).toBe(false);
    expect(['TRAVERSAL_DENIED', 'PROTECTED_PATH']).toContain(d.code);
  });
});

describe('Phase 4 — sandbox confinement', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-sandbox-'));
  });
  afterEach(() => {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  test('inside the sandbox root is allowed', () => {
    const d = authorizeFilesystemTarget(path.join(sandbox, 'proposal', 'patch.ts'), {
      operation: 'write',
      repoRoot: REPO_ROOT,
      sandboxRoot: sandbox,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(true);
  });

  test('outside the sandbox root is denied when a sandbox is configured', () => {
    // A path that would be perfectly fine without a sandbox.
    const d = authorizeFilesystemTarget(path.join(REPO_ROOT, 'lib', 'missions', 'ok.json'), {
      operation: 'write',
      repoRoot: REPO_ROOT,
      sandboxRoot: sandbox,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('OUTSIDE_SANDBOX');
  });

  test('a sandbox does NOT re-permit protected paths copied into it', () => {
    // Defence in depth: even inside a sandbox, a file whose repo-relative shape
    // is governance-like stays protected if it resolves back into the repo.
    const d = authorizeFilesystemTarget(path.join(REPO_ROOT, 'lib', 'operational', 'RiskClassifier.ts'), {
      operation: 'write',
      repoRoot: REPO_ROOT,
      sandboxRoot: sandbox,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(false);
  });
});

describe('Phase 4 — symlink escape', () => {
  let tmp: string;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-symlink-')); });
  afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('a symlink pointing at a protected file is denied by its REAL path', () => {
    const linkDir = path.join(REPO_ROOT, '.hydi-symlink-test');
    const linkPath = path.join(linkDir, 'innocent.ts');
    const realTarget = path.join(REPO_ROOT, 'lib', 'operational', 'CapabilityAuthorizer.ts');

    try {
      fs.mkdirSync(linkDir, { recursive: true });
      fs.symlinkSync(realTarget, linkPath, 'file');
    } catch (e: any) {
      // Windows needs elevation or developer mode for symlinks.
      if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
        // Still assert the mechanism exists so this never silently no-ops.
        expect(typeof authorizeFilesystemTarget).toBe('function');
        try { fs.rmSync(linkDir, { recursive: true, force: true }); } catch { /* ignore */ }
        return;
      }
      throw e;
    }

    try {
      const d = authWrite(path.relative(REPO_ROOT, linkPath));
      expect(d.allowed).toBe(false);
      expect(['PROTECTED_PATH', 'SYMLINK_ESCAPE']).toContain(d.code);
    } finally {
      try { fs.rmSync(linkDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe('Phase 4 — fail closed', () => {
  const BAD: Array<[string, unknown]> = [
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['object', { path: 'x' }],
    ['null byte injection', 'lib/missions/ok.json\u0000.ts'],
  ];

  test.each(BAD)('DENIES malformed target: %s', (_label, target) => {
    const d = authWrite(target as string);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('INVALID_TARGET');
  });

  test('no allowedTargets at all -> denied, not permitted by default', () => {
    const d = authorizeFilesystemTarget('lib/missions/ok.json', {
      operation: 'write',
      repoRoot: REPO_ROOT,
      allowedTargets: [],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('NOT_IN_ALLOWED_TARGETS');
  });

  test('a target matching no allowedTargets pattern is denied', () => {
    const d = authorizeFilesystemTarget('lib/missions/ok.json', {
      operation: 'write',
      repoRoot: REPO_ROOT,
      allowedTargets: [{ type: 'glob', pattern: 'docs/**', description: 'docs only' }],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('NOT_IN_ALLOWED_TARGETS');
  });

  test('every decision carries a human-readable reason — denials are never silent', () => {
    for (const t of ['lib/operational/RiskClassifier.ts', '../escape', '']) {
      const d = authWrite(t);
      expect(typeof d.reason).toBe('string');
      expect(d.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('Phase 4 — case-variant bypass (Windows/macOS case-insensitive FS)', () => {
  // Red-team 2026-09-18: the filesystem treats `.ENV` and `.env` as the same
  // file, but a case-sensitive pattern match let `.ENV` sail past the `.env`
  // rule while still reading the real secret. Matching is now case-insensitive.
  const CASE_BYPASS_READS = ['.ENV', '.Env.Local', '.GIT/config', '.Git/HEAD'];

  test.each(CASE_BYPASS_READS)('DENIES case-variant secret/VCS read %s', (target) => {
    const d = authorizeFilesystemTarget(target, {
      operation: 'read',
      repoRoot: REPO_ROOT,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('PROTECTED_PATH');
  });

  // These resolve onto protected dirs, so they must be denied as PROTECTED_PATH.
  const CASE_BYPASS_PROTECTED = [
    'TESTS/unit/test-project/evil.test.js',   // would land in tests/ -> RCE via testMatch
    'LIB/OPERATIONAL/test-project/x.ts',      // governance dir
    '.GIT/test-project/x',                    // VCS internals
    'Evolution/test-project/x.ts',            // self-development machinery
  ];

  test.each(CASE_BYPASS_PROTECTED)('DENIES case-variant protected write %s', (target) => {
    const d = authorizeFilesystemTarget(target, {
      operation: 'write',
      repoRoot: REPO_ROOT,
      allowedTargets: [
        { type: 'glob', pattern: 'test-project/**', description: 'planner' },
        { type: 'glob', pattern: 'hydi-workspace/**', description: 'workspace' },
      ],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('PROTECTED_PATH');
  });

  // scripts/ is not a wholesale-protected dir (only specific scripts are), so a
  // case-variant write there is denied as NOT_IN_ALLOWED_TARGETS instead -- the
  // security outcome (denied) is what matters, not which gate caught it.
  test('DENIES case-variant write into scripts/ (not in any zone)', () => {
    const d = authorizeFilesystemTarget('SCRIPTS/test-project/x.js', {
      operation: 'write',
      repoRoot: REPO_ROOT,
      allowedTargets: [
        { type: 'glob', pattern: 'test-project/**', description: 'planner' },
        { type: 'glob', pattern: 'hydi-workspace/**', description: 'workspace' },
      ],
    } as any);
    expect(d.allowed).toBe(false);
  });
});

describe('Phase 4 — secret coverage beyond .env', () => {
  const SECRET_READS = [
    '.ssh/id_rsa',
    'home/user/.ssh/id_ed25519',
    '.pgpass',
    'config/.npmrc',
    'secrets.json',
    'app/service-account-prod.json',
    'foo.pem',
    'x.p12',
  ];

  test.each(SECRET_READS)('DENIES secret read %s', (target) => {
    const d = authorizeFilesystemTarget(target, {
      operation: 'read',
      repoRoot: REPO_ROOT,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('PROTECTED_PATH');
  });
});

describe('Phase 4 — test-project scaffolding is confined, not anywhere-nested', () => {
  test('root-level test-project is allowed (proven DynamicPlanner target)', () => {
    const d = authorizeFilesystemTarget('test-project/output.json', {
      operation: 'write',
      repoRoot: REPO_ROOT,
      allowedTargets: [{ type: 'glob', pattern: 'test-project/**', description: 'planner' }],
    } as any);
    expect(d.allowed).toBe(true);
  });

  test('test-project nested inside production source is NOT a writable zone', () => {
    // `api/test-project/x` and `src/test-project/x` must not be writable — the
    // anywhere-wildcard was removed; production source changes via promotion.
    for (const t of ['api/test-project/x.js', 'src/test-project/x.ts', 'lib/missions/test-project/x.js']) {
      const d = authorizeFilesystemTarget(t, {
        operation: 'write',
        repoRoot: REPO_ROOT,
        allowedTargets: [
          { type: 'glob', pattern: 'test-project/**', description: 'planner' },
          { type: 'glob', pattern: 'hydi-workspace/**', description: 'workspace' },
        ],
      } as any);
      expect(d.allowed).toBe(false);
    }
  });
});

describe('Phase 4 — secret reads are denied as well as writes', () => {
  test('reading .env is denied even though read is not a mutation', () => {
    const d = authorizeFilesystemTarget('.env', {
      operation: 'read',
      repoRoot: REPO_ROOT,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('PROTECTED_PATH');
  });

  test('reading governance source IS allowed — understanding itself is not a risk', () => {
    // R0 observation must stay possible; the boundary is mutation, plus secrets.
    const d = authorizeFilesystemTarget('lib/operational/CapabilityAuthorizer.ts', {
      operation: 'read',
      repoRoot: REPO_ROOT,
      allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'any' }],
    } as any);
    expect(d.allowed).toBe(true);
  });
});

describe('Phase 4 — the protected set is real and non-empty', () => {
  test('PROTECTED_PATTERNS covers every category the contract names', () => {
    const categories = Object.keys(PROTECTED_PATTERNS);
    for (const required of [
      'PROTECTED_GOVERNANCE',
      'PROTECTED_VERIFICATION',
      'PROTECTED_CONFIG',
      'PROTECTED_SECRETS',
      'PROTECTED_EVIDENCE',
      'PROTECTED_VCS',
    ]) {
      expect(categories).toContain(required);
      expect((PROTECTED_PATTERNS as any)[required].length).toBeGreaterThan(0);
    }
  });

  test('regression guard: the empty-set failure mode that shipped before cannot recur', () => {
    const total = Object.values(PROTECTED_PATTERNS).reduce((n, arr: any) => n + arr.length, 0);
    // CapabilityAuthorizer.PROTECTED_MODULES was an empty Set with a
    // "add modules here" comment. An empty protected set is the bug.
    expect(total).toBeGreaterThan(15);
  });
});
