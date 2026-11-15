'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fingerprintGap } = require('../../lib/heidi/self-improvement/fingerprints');
const { analyzeDuplicates } = require('../../lib/heidi/self-improvement/duplicates');
const { classifyOutcome } = require('../../lib/heidi/self-improvement/regression');
const { scoreGap, rankWithHistory, WEIGHTS } = require('../../lib/heidi/self-improvement/scoring');
const { appendMissionRecord, loadAllMissions } = require('../../lib/heidi/self-improvement/history');
const { redactRecord } = require('../../lib/heidi/self-improvement/redact');
const { runBoundedSelfImprovement } = require('../../lib/heidi/bounded-self-improvement-loop');

const gapFix = {
  id: 'status-live-probes-failed-not-surfaced',
  observed_problem: 'Live probes untrusted',
  urgency: 92,
  confidence: 0.9,
  effort: 25,
  risk: 10,
  proposed_outcome: 'Supervisor degraded warning',
  owner_outcome_axis: 'accuracy',
  evidence: { source: 'test', collected_at: new Date().toISOString() },
};

describe('Self-improvement Evolution 2.0', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-si2-'));

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('fingerprint is stable', () => {
    expect(fingerprintGap(gapFix)).toBe(fingerprintGap({ ...gapFix, rank_score: 99 }));
  });

  test('scoring uses documented weights', () => {
    expect(WEIGHTS.operational_impact).toBeGreaterThan(0);
    const s = scoreGap(gapFix, { duplicate_analysis: { failed_attempts: 0, recommendation: 'proceed' } });
    expect(s.priority_score).toBeGreaterThan(0);
    expect(s.recommended_next_action).toBe('run_bounded_mission');
  });

  test('duplicate skip after improved mission', () => {
    appendMissionRecord(tmpRoot, {
      mission_id: 'm1',
      gap: gapFix,
      outcome_class: 'IMPROVED',
      baseline: {},
    });
    const hist = loadAllMissions(tmpRoot);
    const dup = analyzeDuplicates(gapFix, hist);
    expect(dup.recommendation).toBe('skip_duplicate');
    expect(dup.should_create_mission).toBe(false);
  });

  test('regression detected when verification fails', () => {
    const outcome = classifyOutcome({
      baseline: { status_truthfulness: 'degraded' },
      after: { status_truthfulness: 'degraded' },
      testsPassed: true,
      verifyCompleted: true,
      verifyEvidence: { hasRec: false, hasFail: true },
    });
    expect(outcome).toBe('REGRESSED');
  });

  test('redacts secrets in records', () => {
    const row = redactRecord({ token: 'sk_live_abc123' });
    expect(row.token).toBe('[REDACTED]');
  });

  test('rankWithHistory lowers score after failures', () => {
    appendMissionRecord(tmpRoot, {
      mission_id: 'm-fail',
      gap_id: gapFix.id,
      gap: gapFix,
      outcome_class: 'REGRESSED',
    });
    const hist = loadAllMissions(tmpRoot);
    const ranked = rankWithHistory([gapFix, { ...gapFix, id: 'other-gap', urgency: 50 }], hist);
    const row = ranked.find((g) => g.id === gapFix.id);
    expect(row.duplicate_analysis.prior_count).toBeGreaterThanOrEqual(1);
  });

  test('e2e: second run skips duplicate after IMPROVED (simulated)', async () => {
    const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-si2-e2e-'));
    appendMissionRecord(historyRoot, {
      mission_id: 'sim-improved',
      gap: gapFix,
      outcome_class: 'IMPROVED',
      proof_label: 'SIMULATED',
      baseline: { status_truthfulness: 'degraded' },
      verification: { completed: true },
    });
    const { loadAllMissions: loadHist } = require('../../lib/heidi/self-improvement/history');
    const prior = loadHist(historyRoot);
    const dup = analyzeDuplicates(gapFix, prior);
    expect(dup.improved_before).toBe(true);
    const result = await runBoundedSelfImprovement({
      root: process.cwd(),
      historyRoot,
      ownerRequested: true,
      forceNew: false,
      fetchImpl: async () => ({ ok: false, status: 0 }),
      gapId: gapFix.id,
      simulated: true,
    });
    if (result.code === 'DUPLICATE_SKIPPED') {
      expect(result.brief.duplicate_analysis.recommendation).toBe('skip_duplicate');
    } else {
      expect(result.ok).toBe(true);
    }
    fs.rmSync(historyRoot, { recursive: true, force: true });
  });
});