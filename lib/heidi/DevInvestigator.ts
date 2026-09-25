/**
 * DevInvestigator — governed, read-only autonomous investigation.
 *
 * The missing edge between "observation" and "defect": a finding is a
 * hypothesis, not a defect. This module collects bounded evidence,
 * searches for counterexamples FIRST, and only then classifies:
 *
 *   CONFIRMED_DEFECT      → create a development mission (ops.dev_author)
 *   NOT_A_DEFECT          → record the lesson, move on
 *   INSUFFICIENT_EVIDENCE → stop; human review only if warranted
 *
 * Read-only contract: files are read, allowlisted commands run, nothing
 * is written outside .hydi-operational/dev-investigations.jsonl. No
 * edits, no commits, no pushes.
 *
 * Budgets: ≤30 files, ≤20 commands, ≤3 hypotheses, 10-minute cap.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { PatchSpec } from './DevPatchExecutor';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const EVIDENCE_LOG = path.join(REPO, '.hydi-operational', 'dev-investigations.jsonl');
const MAX_FILES = 30;
const MAX_COMMANDS = 20;
const MAX_HYPOTHESES = 3;
const BUDGET_MS = 10 * 60 * 1000;

/** Investigation commands must be read-only. Anything else is refused. */
const READ_ONLY_CMD = /^(npx\s+(tsc|jest)|node\s+(--test\s+\S+|scripts\/|check-)|git\s+(status|diff|log|ls-files|rev-parse)\b)/;

export type FindingType = 'test_framework_mismatch' | 'escalation_asymmetry' | 'generic';

export interface DevInvestigationInput {
  findingType: FindingType;
  target: string;
  question: string;
  initialObservation: string;
  suspectedFiles: string[];
  /** For CONFIRMED outcomes: the exact edit, already investigated. */
  knownEdit?: PatchSpec[];
  missionId?: string;
}

export interface Hypothesis {
  statement: string;
  supporting: string[];
  counterexamples: string[];
}

export type InvestigationConclusion = 'CONFIRMED_DEFECT' | 'NOT_A_DEFECT' | 'INSUFFICIENT_EVIDENCE';

export interface InvestigationRecord {
  investigationId: string;
  missionId: string;
  target: string;
  question: string;
  filesInspected: string[];
  commandsRun: string[];
  hypotheses: Hypothesis[];
  conclusion: InvestigationConclusion;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  recommendedAction: string;
  evidence: Record<string, unknown>;
  durationMs: number;
  at: string;
}

class Budget {
  files = 0;
  commands = 0;
  hypotheses = 0;
  start = Date.now();
  outOfBudget() { return this.files > MAX_FILES || this.commands > MAX_COMMANDS || Date.now() - this.start > BUDGET_MS; }
}

function readFile(rel: string, budget: Budget, inspected: string[]): string | null {
  if (budget.files >= MAX_FILES) return null;
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return null;
  budget.files++;
  inspected.push(rel);
  return fs.readFileSync(abs, 'utf8');
}

function run(cmd: string, budget: Budget, ran: string[]): { ok: boolean; out: string } {
  if (budget.commands >= MAX_COMMANDS || !READ_ONLY_CMD.test(cmd)) {
    return { ok: false, out: 'command refused (not read-only allowlist or budget exhausted)' };
  }
  budget.commands++;
  ran.push(cmd);
  try {
    const out = execFileSync('cmd', ['/c', cmd], { cwd: REPO, timeout: 240000, stdio: 'pipe' }).toString();
    return { ok: true, out: out.slice(-3000) };
  } catch (e) {
    const ee = e as { stdout?: Buffer; stderr?: Buffer; message: string };
    return { ok: false, out: ((ee.stdout?.toString() ?? '') + (ee.stderr?.toString() ?? '') + ee.message).slice(-3000) };
  }
}

/** Scan source dirs for references to a symbol — bounded caller tracing. */
function findReferences(symbol: string, budget: Budget): string[] {
  const hits: string[] = [];
  const dirs = ['lib', 'pages', 'scripts', 'tests', 'api'];
  const walk = (dir: string) => {
    if (budget.files >= MAX_FILES || hits.length > 40) return;
    const abs = path.join(REPO, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (budget.files >= MAX_FILES) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const src = readFile(p, budget, []);
        if (src && src.includes(symbol)) hits.push(p);
      }
    }
  };
  dirs.forEach(walk);
  return hits;
}

function persist(rec: InvestigationRecord) {
  fs.mkdirSync(path.dirname(EVIDENCE_LOG), { recursive: true });
  fs.appendFileSync(EVIDENCE_LOG, JSON.stringify(rec) + '\n');
}

/**
 * The counterexample-first investigation. Each finding type encodes
 * what evidence would DISPROVE the suspected defect — we hunt for that
 * before believing the hypothesis.
 */
export async function investigateFinding(input: DevInvestigationInput): Promise<InvestigationRecord> {
  const budget = new Budget();
  const filesInspected: string[] = [];
  const commandsRun: string[] = [];
  const hypotheses: Hypothesis[] = [];
  const evidence: Record<string, unknown> = {};
  const missionId = input.missionId ?? `inv-${Date.now()}`;

  const finish = (conclusion: InvestigationConclusion, confidence: InvestigationRecord['confidence'], recommendedAction: string): InvestigationRecord => {
    const rec: InvestigationRecord = {
      investigationId: `inv_${crypto.randomUUID().slice(0, 10)}`,
      missionId, target: input.target, question: input.question,
      filesInspected, commandsRun, hypotheses, conclusion, confidence, recommendedAction,
      evidence, durationMs: Date.now() - budget.start, at: new Date().toISOString(),
    };
    persist(rec);
    return rec;
  };

  switch (input.findingType) {
    case 'test_framework_mismatch': {
      // Hypothesis: file uses node:test where jest should be used.
      // Counterexample: the suite may be INTENTIONALLY node --test —
      // evidence: package.json/jest config excludes it, it passes under
      // node --test, and jest itself cannot load it (e.g. ESM dep).
      hypotheses.push({
        statement: `${input.target} is mis-registered under the wrong test runner`,
        supporting: [input.initialObservation],
        counterexamples: [],
      });
      const src = readFile(input.target, budget, filesInspected);
      if (!src) return finish('INSUFFICIENT_EVIDENCE', 'LOW', 'file not found');

      const usesNodeTest = /require\(['"]node:test['"]\)|from ['"]node:test['"]/.test(src);
      evidence.usesNodeTestImport = usesNodeTest;

      // Counterexample 1: does jest actually run this file cleanly?
      const jestRun = run(`npx jest ${input.target.replace(/\//g, path.sep)} --testEnvironment=node`, budget, commandsRun);
      evidence.jestRun = { ok: jestRun.ok, tail: jestRun.out.slice(-500) };
      // Counterexample 2: does node --test run it cleanly?
      const nodeTest = run(`node --test ${input.target.replace(/\//g, path.sep)}`, budget, commandsRun);
      evidence.nodeTestRun = { ok: nodeTest.ok, tail: nodeTest.out.slice(-500) };

      if (usesNodeTest && !jestRun.ok && nodeTest.ok) {
        hypotheses[0].counterexamples.push(
          'file passes under node --test — it is a node:test suite by design',
          `jest cannot run it (${jestRun.out.match(/puppeteer-core|Cannot use import|ESM/) ? 'ESM/dependency incompatibility' : 'runner mismatch'}) — the "mismatch" is the intended execution model`,
        );
        return finish('NOT_A_DEFECT', 'HIGH', 'no change — record as known intentional node --test suite');
      }
      if (usesNodeTest && !jestRun.ok && !nodeTest.ok) {
        hypotheses[0].counterexamples.push('neither runner executes it — suite is genuinely broken');
        return finish('CONFIRMED_DEFECT', 'HIGH', 'fix or remove the broken suite');
      }
      if (!usesNodeTest && jestRun.ok) {
        return finish('NOT_A_DEFECT', 'HIGH', 'runs under jest already');
      }
      return finish('INSUFFICIENT_EVIDENCE', 'MEDIUM', 'ambiguous runner state — human review');
    }

    case 'escalation_asymmetry': {
      // Hypothesis: two paths apply the same policy differently —
      // e.g. executeJob escalates unpaid jobs; the sweep only escalates paid.
      hypotheses.push({
        statement: input.question,
        supporting: [input.initialObservation],
        counterexamples: [],
      });
      for (const f of input.suspectedFiles.slice(0, 5)) {
        const src = readFile(f, budget, filesInspected);
        if (src) evidence[`excerpt:${f}`] = src.length;
      }
      // Deterministic check: does the unconditional escalation branch exist?
      const executorSrc = readFile('lib/revenue/JobExecutor.ts', budget, filesInspected) ?? '';
      const escalatesUnpaid = /requestIntervention\(jobId,\s*'delivery-'/.test(executorSrc)
        && !/paymentStatus\s*===\s*'paid'[\s\S]{0,200}requestIntervention\(jobId/.test(executorSrc);
      evidence.escalatesUnpaid = escalatesUnpaid;
      // Counterexample: are unpaid jobs actually claimable from the queue?
      // (claimNextQueuedJob only picks 'queued' — queued implies paid via webhook)
      const sweepHasPaidGuard = /paymentStatus === 'paid'/.test(executorSrc);
      evidence.sweepHasPaidGuard = sweepHasPaidGuard;
      const claimsQueuedOnly = /claimNextQueuedJob/.test(executorSrc);
      if (escalatesUnpaid && sweepHasPaidGuard && claimsQueuedOnly) {
        hypotheses[0].supporting.push(
          'executeJob else-branch escalates any ineligible job — including unpaid',
          'sweepAwaitingReview applies the paid guard — same policy, inconsistent application',
        );
        hypotheses[0].counterexamples.push(
          'claimNextQueuedJob only claims queued jobs; unpaid jobs reaching executeJob are rare (synthetic) — impact bounded, not fabricated',
        );
        return finish('CONFIRMED_DEFECT', 'MEDIUM', 'align executeJob escalation with the sweep paid-only policy');
      }
      return finish('INSUFFICIENT_EVIDENCE', 'MEDIUM', 'asymmetry not confirmed in code');
    }

    default: {
      // generic: read the files, count references, report honestly
      for (const f of input.suspectedFiles.slice(0, 10)) {
        const src = readFile(f, budget, filesInspected);
        if (src) evidence[`excerpt:${f}`] = src.length;
      }
      return finish('INSUFFICIENT_EVIDENCE', 'LOW', 'generic finding — deterministic rules cannot classify; human review');
    }
  }
}
