/**
 * Filesystem authorization for autonomous actions (Phase 4).
 * ---------------------------------------------------------------------------
 * The hole this closes, measured 2026-09-18:
 *
 *   `filesystem.write_file` is declared R1 / autonomous / no-human-approval
 *   with `allowedTargets: [{ type:'glob', pattern:'**\/*' }]`. That field is
 *   declared at 45 sites in ActionCapabilityRegistry.ts and READ AT ZERO --
 *   nothing in the codebase ever consulted it. FilesystemAdapter.writeFile()
 *   was a bare `fs.writeFileSync(target, content)` with no root confinement,
 *   no normalization, no traversal check and no symlink check.
 *
 *   So HYDI could autonomously overwrite AutonomyPolicyModel.ts,
 *   CapabilityAuthorizer.ts, RiskClassifier.ts, its own verification code, or
 *   any evidence ledger -- i.e. rewrite the rules that decide whether it may
 *   act at all.
 *
 * Design notes
 * ------------
 * 1. PROTECTION IS CHECKED BEFORE allowedTargets. This is the load-bearing
 *    ordering: it means no allowlist entry -- not `**\/*`, not even an exact
 *    match on the file itself -- can ever grant a protected path. An allowlist
 *    narrows what is permitted; it can never widen past the protected set.
 *
 * 2. Paths are resolved through symlinks before matching, via the deepest
 *    existing ancestor. A link named `innocent.ts` pointing at
 *    CapabilityAuthorizer.ts is judged as CapabilityAuthorizer.ts.
 *
 * 3. Everything fails closed. Malformed, unresolvable, empty, non-string and
 *    null-byte targets are DENIED. An unknown is never an allow.
 *
 * 4. Reads are permitted for source (understanding itself is not a risk, and
 *    R0 observation must stay possible) but denied for secrets.
 *
 * This module is itself in PROTECTED_GOVERNANCE -- it cannot authorize its own
 * modification.
 */

import fs from 'fs';
import path from 'path';
import type { TargetPattern } from './HumanActionTypes';

export type FsOperation = 'read' | 'write';

export type FsDenialCode =
  | 'ALLOWED'
  | 'INVALID_TARGET'
  | 'TRAVERSAL_DENIED'
  | 'OUTSIDE_SANDBOX'
  | 'SYMLINK_ESCAPE'
  | 'PROTECTED_PATH'
  | 'NOT_IN_ALLOWED_TARGETS';

export interface FsAuthDecision {
  allowed: boolean;
  code: FsDenialCode;
  reason: string;
  resolvedPath: string | null;
  /** Which protected rule matched, when the denial was a protection denial. */
  matchedRule?: string;
}

export interface TargetPatternLike {
  type: string;
  pattern: string;
  description?: string;
}

export interface FsAuthOptions {
  operation: FsOperation;
  repoRoot: string;
  /** When set, writes must land inside this directory as well as pass every other check. */
  sandboxRoot?: string | null;
  allowedTargets?: TargetPatternLike[];
}

/**
 * Paths HYDI may never autonomously modify. Repo-relative, POSIX separators.
 *
 * Derived from the actual architecture, not guessed:
 *   - GOVERNANCE  : the modules that decide whether an action is permitted
 *   - VERIFICATION: the code and config that decide whether a result is real
 *   - CONFIG      : what runs, how it starts, and what it depends on
 *   - SECRETS     : credentials and keys
 *   - EVIDENCE    : ledgers and leases -- history must not be rewritable
 *   - VCS         : git internals
 */
export const PROTECTED_PATTERNS: Record<string, string[]> = {
  PROTECTED_GOVERNANCE: [
    'lib/operational/**',
    'lib/human-action/**',
    'lib/capability-contract/**',
    'lib/protoforge/policy-engine.js',
    'lib/protoforge/action-gate.ts',
    'lib/action-approval.ts',
    // Self-development machinery: the code that observes gaps, plans changes
    // and promotes them cannot itself be an autonomous write target -- that
    // would let HYDI rewrite the process that decides what it may change.
    'evolution/**',
    'lib/governance/**',
  ],
  PROTECTED_VERIFICATION: [
    'tests/**',
    '__tests__/**',
    'jest.config.js',
    'jest.integration.config.js',
    'jest.setup.js',
    'tools/verify.ps1',
    '.githooks/**',
    'scripts/boot-control.js',
    'scripts/boot-restart-handler.js',
    'scripts/boot-instance-lease.js',
    'scripts/recovery-lease.js',
  ],
  PROTECTED_CONFIG: [
    'boot.config.json',
    'boot.config.schema.json',
    'ecosystem.config.js',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.*.json',
    'next.config.js',
    '.gitignore',
    'hydi-runtime.manifest.json',
    'system-manifest.json',
    'scripts/boot-agent.js',
    'scripts/preflight.js',
    'scripts/watchdog.js',
  ],
  PROTECTED_SECRETS: [
    '.env',
    '.env.*',
    '**/.env',
    '**/.env.*',
    '*.key',
    '*.pem',
    '*.crt',
    '**/*.key',
    '**/*.pem',
    '**/*.crt',
    '*.p8',
    '**/*.p8',
    '*.p12',
    '**/*.p12',
    '*.pfx',
    '**/*.pfx',
    '*.keystore',
    '**/*.keystore',
    '*.jks',
    '**/*.jks',
    'certs/**',
    '**/certs/**',
    '.vapid-keys.json',
    '**/.vapid-keys.json',
    '*.vapid-keys.json',
    '**/*.vapid-keys.json',
    // SSH / agent / VCS credential material -- a read leaks private keys.
    '.ssh/**',
    '**/.ssh/**',
    'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
    '**/id_rsa', '**/id_dsa', '**/id_ecdsa', '**/id_ed25519',
    // Per-tool credential files.
    '.pgpass', '**/.pgpass',
    '.npmrc', '**/.npmrc',
    '.netrc', '**/.netrc',
    '.gnupg/**', '**/.gnupg/**',
    '.aws/**', '**/.aws/**',
    '.azure/**', '**/.azure/**',
    'credentials', '**/credentials',
    'secrets.json', '**/secrets.json',
    'service-account*.json', '**/service-account*.json',
    'serviceaccount*.json', '**/serviceaccount*.json',
    // Loose scratch files that have held live secrets on this machine.
    'tmp-secret*', '**/tmp-secret*',
  ],
  PROTECTED_EVIDENCE: [
    '.hydi-operational/**',
    '.hydi/**',
    '.protoforge/**',
    '.recovery-leases/**',
    '.hydi-boot.lock',
    '.hydi-boot-control/**',
    '.heidi-daemon.lock',
    'HYDI_BASELINE.json',
  ],
  PROTECTED_VCS: ['.git/**'],
};

/**
 * The explicit writable zones an autonomous filesystem write may target.
 *
 * The contract for Phase 4 is deny-by-default with named zones, not
 * `** /*` minus a blocklist: an autonomous write is an agent-produced
 * artifact, and agent-produced artifacts have a defined set of places they
 * legitimately land. Production source code -- src/, lib/ pipeline code,
 * api/, pages/, workers/, kilo/, cascade/ -- is NOT a writable zone. It
 * changes through the promotion path (sandbox -> verify -> authorize ->
 * promote), never through an autonomous write.
 *
 * Provenance per zone:
 *   artifacts/**        JobExecutor writes customer-job artifacts here
 *                        (artifacts/customer-jobs/<jobId>/) -- proven use.
 *   reports/**          Generated reports and mission briefings.
 *   docs/**             Documentation, including docs/mission-reviews/.
 *   logs/**             Runtime log output.
 *   hydi-workspace/**   Designated agent working area. Phase 13's
 *                        development sandbox formalizes this; the zone
 *                        exists now so autonomous work has somewhere to
 *                        land that is not the production tree.
 *   test-project/**     DynamicPlanner's project scaffolding directories
 *   **\/test-project/**  (proven use; both root-level and nested forms).
 *
 * Widening this list is a governance change: add a zone deliberately, with
 * a proven consumer, not because a write happened to fail.
 */
export const FILESYSTEM_WRITABLE_ZONES: TargetPattern[] = [
  { type: 'glob', pattern: 'artifacts/**', description: 'Job execution artifacts' },
  { type: 'glob', pattern: 'reports/**', description: 'Generated reports and briefings' },
  { type: 'glob', pattern: 'docs/**', description: 'Documentation and mission reviews' },
  { type: 'glob', pattern: 'logs/**', description: 'Runtime logs' },
  { type: 'glob', pattern: 'hydi-workspace', description: 'Agent workspace root' },
  { type: 'glob', pattern: 'hydi-workspace/**', description: 'Agent workspace' },
  { type: 'glob', pattern: 'test-project', description: 'Planner project root' },
  { type: 'glob', pattern: 'test-project/**', description: 'Planner project files' },
  // NOTE: `**/test-project/**` (test-project nested ANYWHERE) was removed
  // 2026-09-18 after red-team: it let an autonomous write land inside
  // production source (api/, src/, lib/) under a `test-project` name, which
  // contradicts "production source is not a writable zone". DynamicPlanner
  // scaffolds at `${rootDir}/test-project` where rootDir defaults to
  // process.cwd() (repo root) -- covered by the root-level patterns -- or a
  // workspace root -- covered by hydi-workspace/**. Nested scaffolding under a
  // source tree is denied, which is the intended boundary.
];

/** Categories whose protection also applies to reads (secrets must not be exfiltrated). */
const READ_PROTECTED_CATEGORIES = new Set(['PROTECTED_SECRETS', 'PROTECTED_VCS']);

/**
 * Minimal glob matcher: supports `**`, `*` and literal segments -- the only
 * forms used above. Implemented here rather than pulling in minimatch so that
 * the security boundary has no external dependency and the whole matching rule
 * is auditable in one place.
 *
 * MATCHING IS CASE-INSENSITIVE (`i` flag). This is load-bearing on Windows and
 * macOS, whose filesystems are case-insensitive: `.ENV` IS `.env`, `TESTS/` IS
 * `tests/`, and `fs.realpathSync` preserves the caller's casing rather than
 * the on-disk casing. A case-sensitive match there lets `.ENV` sail past the
 * `.env` rule while still reading the real secret file -- measured red-team
 * bypass 2026-09-18. On a case-sensitive filesystem this errs toward denial
 * (a file literally named `.ENV` is judged as `.env`), which is the safe
 * direction for a security boundary.
 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more path segments; a trailing `**` matches the rest.
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else {
        out += '[^/]*';
      }
    } else if (c === '.') out += '\\.';
    else if ('+?^${}()|[]\\'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp('^' + out + '$', 'i');
}

const COMPILED: Array<{ category: string; pattern: string; re: RegExp }> = Object.entries(
  PROTECTED_PATTERNS
).flatMap(([category, patterns]) =>
  patterns.map((pattern) => ({ category, pattern, re: globToRegExp(pattern) }))
);

/**
 * Resolve symlinks using the deepest ancestor that actually exists, so a target
 * that does not exist yet (a file about to be created) still cannot be smuggled
 * through a symlinked parent directory.
 */
function realResolve(absPath: string): string {
  let probe = absPath;
  const tail: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = fs.realpathSync(probe);
      return tail.length ? path.resolve(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return absPath; // reached the root without resolving
      tail.push(path.basename(probe));
      probe = parent;
    }
  }
  return absPath;
}

function deny(code: FsDenialCode, reason: string, resolvedPath: string | null, matchedRule?: string): FsAuthDecision {
  return { allowed: false, code, reason, resolvedPath, ...(matchedRule ? { matchedRule } : {}) };
}

/**
 * Decide whether an autonomous filesystem operation on `target` is permitted.
 * Returns a structured decision; never throws.
 */
export function authorizeFilesystemTarget(target: unknown, options: FsAuthOptions): FsAuthDecision {
  const { operation, repoRoot, sandboxRoot, allowedTargets } = options;

  // --- 1. Shape. Fail closed on anything that is not a usable path string.
  if (typeof target !== 'string' || target.trim() === '') {
    return deny('INVALID_TARGET', `Target must be a non-empty string; received ${typeof target}`, null);
  }
  if (target.includes(' ')) {
    return deny('INVALID_TARGET', 'Target contains a null byte, which can truncate the path at the syscall boundary', null);
  }

  // --- 2. Resolve to an absolute real path (defeats `..` and symlinks together).
  let resolved: string;
  try {
    resolved = realResolve(path.resolve(repoRoot, target));
  } catch (e) {
    return deny('INVALID_TARGET', `Target could not be resolved: ${(e as Error).message}`, null);
  }

  const realRepoRoot = realResolve(repoRoot);
  const relFromRepo = path.relative(realRepoRoot, resolved).split(path.sep).join('/');
  const insideRepo = relFromRepo !== '' && !relFromRepo.startsWith('../') && !path.isAbsolute(relFromRepo);

  // --- 3. Sandbox confinement, when one is configured.
  if (sandboxRoot) {
    const realSandbox = realResolve(path.resolve(sandboxRoot));
    const relFromSandbox = path.relative(realSandbox, resolved);
    const insideSandbox = relFromSandbox !== '' && !relFromSandbox.startsWith('..') && !path.isAbsolute(relFromSandbox);
    if (!insideSandbox) {
      // Still report a protected hit in preference, so the reason is the most
      // specific true statement rather than merely "wrong directory".
      if (insideRepo) {
        const hit = matchProtected(relFromRepo, operation);
        if (hit) {
          return deny('PROTECTED_PATH', protectedReason(relFromRepo, hit), resolved, `${hit.category}:${hit.pattern}`);
        }
      }
      return deny(
        'OUTSIDE_SANDBOX',
        `Autonomous writes are confined to the development sandbox (${realSandbox}); ${resolved} is outside it`,
        resolved
      );
    }
    // Inside the sandbox, but a path that resolves back into the repo is still
    // judged against the protected set -- defence in depth.
    if (insideRepo) {
      const hit = matchProtected(relFromRepo, operation);
      if (hit) return deny('PROTECTED_PATH', protectedReason(relFromRepo, hit), resolved, `${hit.category}:${hit.pattern}`);
    }
    return allowIfMatchesAllowlist(relFromSandbox.split(path.sep).join('/'), resolved, allowedTargets);
  }

  // --- 4. No sandbox: confine to the repository.
  if (!insideRepo) {
    return deny(
      'TRAVERSAL_DENIED',
      `Resolved path escapes the repository root (${realRepoRoot} -> ${resolved})`,
      resolved
    );
  }

  // --- 5. Protection, BEFORE the allowlist. No allowlist entry can widen this.
  const hit = matchProtected(relFromRepo, operation);
  if (hit) return deny('PROTECTED_PATH', protectedReason(relFromRepo, hit), resolved, `${hit.category}:${hit.pattern}`);

  // --- 6. Finally, the capability's own allowlist narrows what remains.
  return allowIfMatchesAllowlist(relFromRepo, resolved, allowedTargets);
}

function matchProtected(relPath: string, operation: FsOperation): { category: string; pattern: string } | null {
  for (const entry of COMPILED) {
    if (operation === 'read' && !READ_PROTECTED_CATEGORIES.has(entry.category)) continue;
    if (entry.re.test(relPath)) return { category: entry.category, pattern: entry.pattern };
  }
  return null;
}

/** Category-specific rationale, so a denial says something true about THIS path. */
const CATEGORY_RATIONALE: Record<string, string> = {
  PROTECTED_GOVERNANCE:
    'HYDI may not autonomously modify the mechanisms that decide whether it is allowed to act.',
  PROTECTED_VERIFICATION:
    'HYDI may not autonomously modify the code or configuration that decides whether a result is real.',
  PROTECTED_CONFIG:
    'HYDI may not autonomously modify what runs, how it starts, or what it depends on.',
  PROTECTED_SECRETS:
    'Credentials and keys are never read or written through an autonomous action.',
  PROTECTED_EVIDENCE:
    'Ledgers and leases are append-only history; HYDI may not rewrite the record of what it has done.',
  PROTECTED_VCS:
    'Version control internals are not an autonomous action target.',
};

function protectedReason(relPath: string, hit: { category: string; pattern: string }): string {
  const rationale = CATEGORY_RATIONALE[hit.category] ?? 'This path is protected.';
  return `${relPath} is protected by ${hit.category} (rule: ${hit.pattern}). ${rationale} This requires explicit human authorization.`;
}

function allowIfMatchesAllowlist(
  relPath: string,
  resolved: string,
  allowedTargets?: TargetPatternLike[]
): FsAuthDecision {
  if (!allowedTargets || allowedTargets.length === 0) {
    return deny('NOT_IN_ALLOWED_TARGETS', 'Capability declares no allowedTargets, so nothing is permitted (fail closed)', resolved);
  }
  for (const t of allowedTargets) {
    if (t.type === 'any') return { allowed: true, code: 'ALLOWED', reason: `Permitted by allowedTargets entry (type=any)`, resolvedPath: resolved };
    if (globToRegExp(t.pattern).test(relPath)) {
      return { allowed: true, code: 'ALLOWED', reason: `Permitted by allowedTargets pattern '${t.pattern}'`, resolvedPath: resolved };
    }
  }
  return deny(
    'NOT_IN_ALLOWED_TARGETS',
    `${relPath} matches none of the capability's allowedTargets patterns (${allowedTargets.map((t) => t.pattern).join(', ')})`,
    resolved
  );
}
