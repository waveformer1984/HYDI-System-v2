/**
 * DevPatchPlanner — the authoring edge of the autonomous dev loop.
 *
 * Turns a bounded Finding into a ChangeProposal containing EXACT patches
 * consumable by ops.dev_patch. Authoring is separated from execution:
 * this module produces the proposal; DevPatchExecutor applies it;
 * the existing verification gate independently checks it.
 *
 * Provider order:
 *   1. explicit-fix finding (evidence already carries the exact edit)
 *   2. local LLM (Ollama qwen2.5-coder) — bounded prompt, strict JSON
 *      output, and the patch must still survive validation before it
 *      earns HIGH confidence
 *   3. UNKNOWN — no fabrication; unknown findings become human actions
 *
 * Confidence rules:
 *   HIGH   → every oldString exists verbatim in the target file(s),
 *            patch passes bounds validation, a verify plan exists
 *   MEDIUM → produced but couldn't be fully pre-validated → HUMAN_REQUIRED
 *   UNKNOWN→ no safe patch → HUMAN_REQUIRED
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validatePatchBounds, PatchSpec } from './DevPatchExecutor';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const AUTHOR_MODEL = process.env.DEV_AUTHOR_MODEL || 'qwen2.5-coder:1.5b';
const LLM_TIMEOUT_MS = 90000;

export interface DevFinding {
  problem: string;
  evidence: string;
  targetFiles: string[];
  expectedBehavior?: string;
  /** If prior investigation produced the exact edit, carry it — no model needed. */
  knownEdit?: PatchSpec[];
  missionId?: string;
}

export interface ChangeProposal {
  proposalId: string;
  missionId: string;
  problem: string;
  evidence: string;
  files: string[];
  patches: PatchSpec[];
  expectedBehavior: string;
  verificationPlan: string;
  /** Executable verify commands (npx/node/npm only) — passed to the executor. */
  verifyCommands?: string[];
  riskLevel: 'R0' | 'R1' | 'R2';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  author: 'deterministic' | 'local_llm';
  patchHash?: string;
  reason?: string;
}

function sha(s: string) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }

function prevalidate(patches: PatchSpec[]): { ok: boolean; reason?: string } {
  const b = validatePatchBounds(patches);
  if (!b.ok) return { ok: false, reason: b.reason };
  for (const p of patches) {
    const abs = path.join(REPO, p.file);
    if (!fs.existsSync(abs)) return { ok: false, reason: `file missing: ${p.file}` };
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.includes(p.oldString)) return { ok: false, reason: `oldString not found verbatim in ${p.file}` };
    if (src.split(p.oldString).length - 1 !== 1) return { ok: false, reason: `oldString ambiguous (${p.file}) — must match exactly once` };
  }
  return { ok: true };
}

async function localLlmAuthor(finding: DevFinding): Promise<{ patches: PatchSpec[]; raw: string } | null> {
  const files = finding.targetFiles.map(f => {
    const abs = path.join(REPO, f);
    const src = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    return `--- ${f} ---\n${src.length > 6000 ? src.slice(0, 6000) + '\n…(truncated)' : src}`;
  }).join('\n\n');
  const prompt = `You are a surgical code reviewer. A defect was found in this repository.

PROBLEM: ${finding.problem}
EVIDENCE: ${finding.evidence}
EXPECTED: ${finding.expectedBehavior ?? 'make the code match the stated problem'}

FILES:
${files}

Respond with ONLY a JSON array (no prose, no markdown fences):
[{"file":"<relative path>","oldString":"<exact substring currently in the file>","newString":"<replacement>"}]

Rules: oldString must be copied verbatim from the file (unique occurrence). Minimal change only. If you cannot produce a safe fix, respond with [].`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: AUTHOR_MODEL, prompt, stream: false, options: { temperature: 0, num_predict: 1200 } }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as { response?: string };
    const raw = (data.response ?? '').trim();
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { patches: [], raw };
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ file?: string; oldString?: string; newString?: string }>;
    const patches: PatchSpec[] = parsed
      .filter(p => p.file && typeof p.oldString === 'string' && typeof p.newString === 'string')
      .map(p => ({ file: String(p.file), oldString: p.oldString!, newString: p.newString! }));
    return { patches, raw };
  } catch {
    return null;
  }
}

function planVerification(targetFiles: string[]): { plan: string; commands: string[] } {
  // Typecheck always. For test-file changes, the real gate is the suite —
  // tsc alone can't prove a jest test is still meaningful.
  const cmds: string[] = [];
  const testFiles = targetFiles.filter(f => f.startsWith('tests/'));
  for (const f of testFiles) cmds.push(`npx jest ${f} --testEnvironment=node`);
  return { plan: ['tsc --noEmit', ...cmds].join('; '), commands: cmds };
}

export async function authorPatchProposal(finding: DevFinding): Promise<ChangeProposal> {
  const missionId = finding.missionId ?? `dev-${Date.now()}`;
  const proposalId = `prop_${crypto.randomUUID().slice(0, 10)}`;
  const verify = planVerification(finding.targetFiles);

  // Path 1: the finding already carries the exact edit (deterministic).
  if (finding.knownEdit?.length) {
    const v = prevalidate(finding.knownEdit);
    if (!v.ok) {
      return { proposalId, missionId, problem: finding.problem, evidence: finding.evidence, files: finding.targetFiles, patches: [], expectedBehavior: finding.expectedBehavior ?? '', verificationPlan: verify.plan, verifyCommands: verify.commands, riskLevel: 'R2', confidence: 'UNKNOWN', author: 'deterministic', reason: `knownEdit failed prevalidation: ${v.reason}` };
    }
    return { proposalId, missionId, problem: finding.problem, evidence: finding.evidence, files: finding.targetFiles, patches: finding.knownEdit, expectedBehavior: finding.expectedBehavior ?? '', verificationPlan: verify.plan, verifyCommands: verify.commands, riskLevel: 'R2', confidence: 'HIGH', author: 'deterministic', patchHash: sha(JSON.stringify(finding.knownEdit)) };
  }

  // Path 2: local LLM authoring — still validated before it counts.
  const llm = await localLlmAuthor(finding);
  if (!llm) {
    return { proposalId, missionId, problem: finding.problem, evidence: finding.evidence, files: finding.targetFiles, patches: [], expectedBehavior: finding.expectedBehavior ?? '', verificationPlan: verify.plan, verifyCommands: verify.commands, riskLevel: 'R2', confidence: 'UNKNOWN', author: 'local_llm', reason: 'local LLM unavailable or timed out' };
  }
  if (llm.patches.length === 0) {
    return { proposalId, missionId, problem: finding.problem, evidence: finding.evidence, files: finding.targetFiles, patches: [], expectedBehavior: finding.expectedBehavior ?? '', verificationPlan: verify.plan, verifyCommands: verify.commands, riskLevel: 'R2', confidence: 'UNKNOWN', author: 'local_llm', reason: 'model declined — no safe patch produced' };
  }
  const v = prevalidate(llm.patches);
  if (!v.ok) {
    return { proposalId, missionId, problem: finding.problem, evidence: finding.evidence, files: finding.targetFiles, patches: llm.patches, expectedBehavior: finding.expectedBehavior ?? '', verificationPlan: verify.plan, verifyCommands: verify.commands, riskLevel: 'R2', confidence: 'LOW', author: 'local_llm', patchHash: sha(JSON.stringify(llm.patches)), reason: `LLM patch failed prevalidation: ${v.reason}` };
  }
  return { proposalId, missionId, problem: finding.problem, evidence: finding.evidence, files: finding.targetFiles, patches: llm.patches, expectedBehavior: finding.expectedBehavior ?? '', verificationPlan: verify.plan, verifyCommands: verify.commands, riskLevel: 'R2', confidence: 'HIGH', author: 'local_llm', patchHash: sha(JSON.stringify(llm.patches)) };
}
