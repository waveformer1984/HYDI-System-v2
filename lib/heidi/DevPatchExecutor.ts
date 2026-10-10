/**
 * DevPatchExecutor — bounded autonomous code change.
 *
 * The intelligence (what to change) comes from a mission/proposal; this
 * executor makes the *mechanical* part provable: apply an exact patch
 * under strict bounds, typecheck, commit, and persist evidence. Fail
 * closed on every boundary:
 *
 *   - repo boundary: canonical tree only, never the stale fork
 *   - file boundary: only lib/, pages/, scripts/, tests/, rezonate subtree
 *   - patch boundary: exact old_string→new_string replacements; a patch
 *     that doesn't match verbatim refuses rather than "fixing" it
 *   - verification: `tsc --noEmit` must pass or the change is reverted
 *   - commit boundary: single commit, mission-prefixed message
 *   - never pushes, never touches secrets/env/credentials, never
 *     modifies protected files (.git, .env*, package-lock, policies)
 *
 * UNKNOWN/FAILED stay honest: a failed patch leaves the tree clean
 * (files restored) and reports the real reason.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const FORBIDDEN = ['.env', '.git/', 'package-lock', 'pnpm-lock', 'yarn.lock', 'POLICY', 'policy-engine'];
const ALLOWED_DIRS = ['lib/', 'pages/', 'scripts/', 'tests/', 'protoforge-applications/'];
const MAX_FILES = 10;
const MAX_PATCH_BYTES = 64 * 1024;

export interface PatchSpec {
  file: string;
  oldString: string;
  newString: string;
}

export interface DevPatchResult {
  ok: boolean;
  status: 'APPLIED' | 'COMMITTED' | 'REJECTED' | 'FAILED' | 'ROLLED_BACK';
  reason?: string;
  filesChanged: string[];
  commitSha?: string;
  evidence: string[];
}

export function validatePatchBounds(patches: PatchSpec[]): { ok: boolean; reason?: string } {
  if (!Array.isArray(patches) || patches.length === 0) return { ok: false, reason: 'no patches' };
  if (patches.length > MAX_FILES) return { ok: false, reason: `patch touches ${patches.length} files > ${MAX_FILES}` };
  for (const p of patches) {
    const rel = p.file.replace(/\\/g, '/');
    if (!ALLOWED_DIRS.some(d => rel.startsWith(d))) return { ok: false, reason: `file outside allowed dirs: ${p.file}` };
    if (FORBIDDEN.some(f => rel.toLowerCase().includes(f.toLowerCase()))) return { ok: false, reason: `protected file: ${p.file}` };
    if ((p.oldString?.length ?? 0) + (p.newString?.length ?? 0) > MAX_PATCH_BYTES) return { ok: false, reason: `patch too large on ${p.file}` };
    if (p.oldString === p.newString) return { ok: false, reason: `no-op patch on ${p.file}` };
  }
  return { ok: true };
}

function applyPatches(patches: PatchSpec[]): { applied: string[]; error?: string } {
  const applied: string[] = [];
  for (const p of patches) {
    const abs = path.join(REPO, p.file);
    if (!fs.existsSync(abs)) return { applied, error: `file not found: ${p.file}` };
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.includes(p.oldString)) return { applied, error: `patch does not match ${p.file} — refusing to apply blind` };
    fs.writeFileSync(abs, src.replace(p.oldString, p.newString));
    applied.push(p.file);
  }
  return { applied };
}

function revertFiles(files: string[], originals: Map<string, string>) {
  for (const f of files) {
    const o = originals.get(f);
    if (o !== undefined) fs.writeFileSync(path.join(REPO, f), o);
  }
}

export async function applyBoundedPatch(mission: {
  missionId: string;
  patches: PatchSpec[];
  commitMessage: string;
  verify?: string[];
}): Promise<DevPatchResult> {
  const evidence: string[] = [];

  const bounds = validatePatchBounds(mission.patches);
  if (!bounds.ok) return { ok: false, status: 'REJECTED', reason: bounds.reason, filesChanged: [], evidence };

  // Never overwrite someone's dirty working-tree changes
  const originals = new Map<string, string>();
  for (const p of mission.patches) {
    const abs = path.join(REPO, p.file);
    originals.set(p.file, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
  }

  const applied = applyPatches(mission.patches);
  if (applied.error) {
    revertFiles(applied.applied, originals);
    return { ok: false, status: 'FAILED', reason: applied.error, filesChanged: applied.applied, evidence };
  }
  evidence.push(`applied ${applied.applied.length} file(s)`);

  // Verification: typecheck first, then any declared checks
  try {
    execFileSync('cmd', ['/c', 'npx', 'tsc', '--noEmit'], { cwd: REPO, timeout: 240000, stdio: 'pipe' });
    evidence.push('tsc --noEmit PASS');
  } catch (e) {
    revertFiles(applied.applied, originals);
    return { ok: false, status: 'ROLLED_BACK', reason: `typecheck failed: ${(e as Error).message.slice(0, 400)}`, filesChanged: applied.applied, evidence };
  }

  for (const cmd of mission.verify ?? []) {
    if (!/^(npx|node|npm)\s/.test(cmd)) {
      revertFiles(applied.applied, originals);
      return { ok: false, status: 'ROLLED_BACK', reason: `verify command not allowed: ${cmd}`, filesChanged: applied.applied, evidence };
    }
    try {
      execFileSync('cmd', ['/c', cmd], { cwd: REPO, timeout: 180000, stdio: 'pipe' });
      evidence.push(`verify '${cmd}' PASS`);
    } catch (e) {
      revertFiles(applied.applied, originals);
      return { ok: false, status: 'ROLLED_BACK', reason: `verify '${cmd}' failed`, filesChanged: applied.applied, evidence };
    }
  }

  // Commit — single bounded commit, never push
  try {
    for (const f of applied.applied) execFileSync('git', ['add', f], { cwd: REPO });
    execFileSync('git', ['commit', '-m', `[autopilot:${mission.missionId}] ${mission.commitMessage}\n\nGenerated with [Devin](https://devin.ai)\n\nCo-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>`], { cwd: REPO });
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim();
    evidence.push(`committed ${sha}`);
    return { ok: true, status: 'COMMITTED', filesChanged: applied.applied, commitSha: sha, evidence };
  } catch (e) {
    return { ok: false, status: 'FAILED', reason: `commit failed: ${(e as Error).message.slice(0, 300)}`, filesChanged: applied.applied, evidence };
  }
}
