/**
 * recoverStaleJobs regression — recovery must only touch jobs orphaned
 * by a restart, never jobs still executing under a live poller.
 *
 * Bug: model-prep-executor-scheduler runs recoverStaleJobs() every poll
 * cycle. A job whose fulfillment outlived one interval was failed
 * mid-execution as "restarted during execution". The age guard in
 * JobExecutor is the durable fix.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { recoverStaleJobs, STALE_EXECUTION_MS } from '../../lib/revenue/JobExecutor';

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job_test',
    product: 'checkpoint_audit',
    jobStatus: 'executing',
    paymentStatus: 'paid',
    deliveryStatus: 'pending',
    artifactPaths: [] as string[],
    executionStartedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as any;
}

function fakeManager(jobs: any[], artifactsDir: string) {
  return {
    calls: { failed: [] as string[], completed: [] as string[], approved: [] as string[], intervened: [] as string[] },
    getJobsByStatus: async (s: string) => jobs.filter(j => j.jobStatus === s),
    getArtifactsDir: () => artifactsDir,
    failExecution: async (id: string) => { fakeMgr.calls.failed.push(id); return fakeJob({ jobId: id, jobStatus: 'failed' }); },
    completeExecution: async (id: string, artifacts: any[]) => { fakeMgr.calls.completed.push(id); return fakeJob({ jobId: id, jobStatus: 'awaiting_review', artifactPaths: artifacts.map(a => a.path) }); },
    approveForDelivery: async (id: string) => { fakeMgr.calls.approved.push(id); return fakeJob({ jobId: id, jobStatus: 'delivered', deliveryStatus: 'delivered' }); },
    requestIntervention: async (id: string) => { fakeMgr.calls.intervened.push(id); return fakeJob({ jobId: id }); },
  } as any;
}
let fakeMgr: ReturnType<typeof fakeManager>;
const init = (jobs: any[], dir: string) => { fakeMgr = fakeManager(jobs, dir); return fakeMgr; };

const AUDIT_MD = '# Checkpoint Workflow Audit\n' + 'workflow risk analysis '.repeat(20);
const AUDIT_JSON = JSON.stringify({ analyzeResult: { workflow_id: 9 }, report: { risk_level: 'MEDIUM', steps: [{ number: 1, name: 'x', risk: 5 }] } });

describe('recoverStaleJobs — in-flight age guard', () => {
  test('skips a job still executing (started < staleAfterMs ago)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    const mgr = init([fakeJob({ jobId: 'job_fresh' })], dir);
    const r = await recoverStaleJobs({ jobManager: mgr });
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
    expect(mgr.calls.failed).toEqual([]);
  });

  test('fails an old executing job with no artifacts (genuine orphan)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    const old = new Date(Date.now() - STALE_EXECUTION_MS - 60_000).toISOString();
    const mgr = init([fakeJob({ jobId: 'job_orphan', executionStartedAt: old, updatedAt: old })], dir);
    const r = await recoverStaleJobs({ jobManager: mgr });
    expect(r.failed).toBe(1);
    expect(mgr.calls.failed).toEqual(['job_orphan']);
  });

  test('recovers an old executing job when complete artifacts exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    const jobDir = path.join(dir, 'job_done');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'checkpoint-audit.md'), AUDIT_MD);
    fs.writeFileSync(path.join(jobDir, 'audit-data.json'), AUDIT_JSON);
    const old = new Date(Date.now() - STALE_EXECUTION_MS - 60_000).toISOString();
    const mgr = init([fakeJob({ jobId: 'job_done', executionStartedAt: old })], dir);
    const r = await recoverStaleJobs({ jobManager: mgr });
    expect(r.recovered).toBe(1);
    expect(mgr.calls.completed).toEqual(['job_done']);
  });

  test('honours a custom staleAfterMs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
    const twoMinAgo = new Date(Date.now() - 120_000).toISOString();
    const mgr = init([fakeJob({ jobId: 'job_mid', executionStartedAt: twoMinAgo })], dir);
    // default 10min → skipped; 60s window → stale → failed
    const r1 = await recoverStaleJobs({ jobManager: mgr });
    expect(r1.skipped).toBe(1);
    const r2 = await recoverStaleJobs({ jobManager: mgr, staleAfterMs: 60_000 });
    expect(r2.failed).toBe(1);
  });
});
