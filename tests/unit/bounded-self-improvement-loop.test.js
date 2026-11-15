'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runBoundedSelfImprovement,
  assessImprovementOpportunities,
  LIMITS,
} = require('../../lib/heidi/bounded-self-improvement-loop');
const { storeDir } = require('../../lib/heidi/self-improvement-store');

describe('bounded self-improvement loop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-si-'));

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('refuses without owner request', async () => {
    const r = await runBoundedSelfImprovement({ root, fetchImpl: async () => ({ ok: false }) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('OWNER_REQUEST_REQUIRED');
  });

  test('assess ranks gaps from failed live probes', async () => {
    const report = await assessImprovementOpportunities({
      root: process.cwd(),
      fetchImpl: async () => ({ ok: false, status: 0 }),
    });
    expect(report.gaps.length).toBeGreaterThan(0);
    const top = report.gaps.find((g) => g.id === 'status-live-probes-failed-not-surfaced');
    expect(top).toBeTruthy();
    expect(report.gaps[0].id).toBe('status-live-probes-failed-not-surfaced');
  });

  test('demo chain respects step limit constant', () => {
    expect(LIMITS.maxSteps).toBe(5);
    expect(LIMITS.maxConsecutiveFailures).toBe(2);
  });

  test('run completes verify for degraded probe gap', async () => {
    fs.rmSync(storeDir(root), { recursive: true, force: true });
    const r = await runBoundedSelfImprovement({
      root: process.cwd(),
      ownerRequested: true,
      forceNew: true,
      fetchImpl: async () => ({ ok: false, status: 0 }),
    });
    expect(r.ok).toBe(true);
    expect(r.brief.chosen_improvement).toBeTruthy();
    expect(r.brief.proof.labels.tests_passed).toBe(true);
    expect(r.progress.some((p) => p.step === 'verify' && p.completed)).toBe(true);
  });
});