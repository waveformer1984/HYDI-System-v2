/**
 * Qualification scenarios for RevenueReconciliationDetector
 *
 * Tests both the true-positive case (a real discrepancy gets caught and
 * escalated) and the false-positive case (normal operation is left alone
 * — a reconciliation goal that flags healthy state as a mismatch would
 * be worse than not running at all).
 */

import { RevenueReconciliationDetector } from '../../lib/operational/RevenueReconciliationDetector';
import { resetEscalationNotifier } from '../../lib/operational/EscalationNotifier';

// Mock Supabase client that returns configurable data
function createMockSupabase(jobs: any[], ledgerEntries: any[], jobEvents: Record<string, any[]>, options?: { boundary?: string | null }) {
  const insertLog: any[] = [];
  const boundary = options?.boundary;

  return {
    _insertLog: insertLog,
    from(table: string) {
      if (table === 'operational_boundary') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({
                data: boundary === undefined ? { go_live_at: new Date().toISOString() } : (boundary === null ? null : { go_live_at: boundary }),
                error: boundary === null ? { message: 'not found' } : null,
              }),
            }),
          }),
        };
      }
      if (table === 'customer_jobs') {
        return {
          select: () => ({
            in: (_col: string, _vals: any[]) => ({
              or: (_filter: string) => ({
                gte: () => Promise.resolve({ data: jobs, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'revenue_ledger') {
        return {
          select: () => ({
            gte: () => Promise.resolve({ data: ledgerEntries, error: null }),
          }),
        };
      }
      if (table === 'operator_escalations') {
        return {
          insert: (row: any) => {
            insertLog.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'push_subscriptions') {
        return {
          select: () => Promise.resolve({ data: [], error: null }),
        };
      }
      // Generic fallback for any other table
      return {
        select: () => Promise.resolve({ data: [], error: null }),
        insert: (row: any) => {
          insertLog.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

// Mock RevenueReconciler that returns configurable results per job
function mockReconciler(results: Record<string, any>) {
  return {
    reconcile: async (jobId: string) => {
      if (results[jobId]) return results[jobId];
      // Default: consistent
      return {
        state: 'CONSISTENT',
        jobId,
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: [],
        summary: `Job ${jobId}: all stages PASS`,
      };
    },
  };
}

describe('RevenueReconciliationDetector qualification scenarios', () => {
  beforeEach(() => {
    resetEscalationNotifier();
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => { });
    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a job with a real mismatch is detected and escalated', async () => {
    const jobs = [{ job_id: 'job-mismatch-001', stripe_checkout_session_id: 'cs_live_test1' }];
    const ledger = [{ verified: true }, { verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}),
      observeOnly: false,
    });

    // Inject mock reconciler
    (detector as any).reconciler = mockReconciler({
      'job-mismatch-001': {
        state: 'MISMATCH',
        jobId: 'job-mismatch-001',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: { paymentConfirmed: { status: 'FAIL', detail: 'No ledger entry' } },
        violations: ['SAFETY: Payment is confirmed but no ledger entry exists'],
        summary: 'Job job-mismatch-001: MISMATCH. Failed stages: paymentConfirmed. Violations: 1.',
      },
    });

    const summary = await detector.detectAndEscalate();

    expect(summary.totalJobs).toBe(1);
    expect(summary.mismatch).toBe(1);
    expect(summary.consistent).toBe(0);
    expect(summary.escalated).toBe(1);
    expect(summary.mismatches).toHaveLength(1);
    expect(summary.mismatches[0].jobId).toBe('job-mismatch-001');
    expect(summary.mismatches[0].violations).toContain('SAFETY: Payment is confirmed but no ledger entry exists');
  });

  test('a healthy job population is NOT flagged as mismatch (false-positive prevention)', async () => {
    const jobs = [
      { job_id: 'job-healthy-001', stripe_checkout_session_id: 'cs_live_h1' },
      { job_id: 'job-healthy-002', stripe_checkout_session_id: 'cs_live_h2' },
      { job_id: 'job-healthy-003', stripe_checkout_session_id: 'cs_live_h3' },
    ];
    const ledger = [{ verified: true }, { verified: true }, { verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({});

    const summary = await detector.detectAndEscalate();

    expect(summary.totalJobs).toBe(3);
    expect(summary.consistent).toBe(3);
    expect(summary.mismatch).toBe(0);
    expect(summary.escalated).toBe(0);
    expect(summary.mismatches).toHaveLength(0);
  });

  test('unverified ledger entries are escalated', async () => {
    const jobs: any[] = [];
    const ledger = [
      { verified: true },
      { verified: true },
      { verified: false }, // unverified!
      { verified: false }, // unverified!
    ];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({});

    const summary = await detector.detectAndEscalate();

    expect(summary.unverifiedLedgerEntries).toBe(2);
    expect(summary.escalated).toBe(1); // One escalation for unverified entries
    expect(summary.mismatch).toBe(0); // No job mismatches
  });

  test('a job in BLOCKED state (awaiting_review) is NOT escalated', async () => {
    const jobs = [{ job_id: 'job-blocked-001', stripe_checkout_session_id: 'cs_live_blocked' }];
    const ledger = [{ verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({
      'job-blocked-001': {
        state: 'BLOCKED',
        jobId: 'job-blocked-001',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: [],
        summary: 'Job job-blocked-001: awaiting human approval.',
      },
    });

    const summary = await detector.detectAndEscalate();

    expect(summary.blocked).toBe(1);
    expect(summary.mismatch).toBe(0);
    expect(summary.escalated).toBe(0); // BLOCKED is intentional, not a mismatch
  });

  test('a mix of healthy and mismatched jobs only escalates the mismatches', async () => {
    const jobs = [
      { job_id: 'job-healthy-001', stripe_checkout_session_id: 'cs_live_h1' },
      { job_id: 'job-mismatch-001', stripe_checkout_session_id: 'cs_live_m1' },
      { job_id: 'job-healthy-002', stripe_checkout_session_id: 'cs_live_h2' },
      { job_id: 'job-blocked-001', stripe_checkout_session_id: 'cs_live_b1' },
    ];
    const ledger = [{ verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({
      'job-mismatch-001': {
        state: 'MISMATCH',
        jobId: 'job-mismatch-001',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: ['SAFETY: Delivery without approval'],
        summary: 'Job job-mismatch-001: MISMATCH.',
      },
      'job-blocked-001': {
        state: 'BLOCKED',
        jobId: 'job-blocked-001',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: [],
        summary: 'Job job-blocked-001: awaiting human approval.',
      },
    });

    const summary = await detector.detectAndEscalate();

    expect(summary.totalJobs).toBe(4);
    expect(summary.consistent).toBe(2); // healthy-001, healthy-002
    expect(summary.mismatch).toBe(1); // mismatch-001
    expect(summary.blocked).toBe(1); // blocked-001
    expect(summary.escalated).toBe(1); // only the mismatch
  });

  test('observe-only mode detects mismatches but does NOT escalate', async () => {
    const jobs = [{ job_id: 'job-mismatch-001', stripe_checkout_session_id: 'cs_live_obs' }];
    const ledger = [{ verified: false }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}),
      observeOnly: true,
    });

    (detector as any).reconciler = mockReconciler({
      'job-mismatch-001': {
        state: 'MISMATCH',
        jobId: 'job-mismatch-001',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: ['SAFETY: Missing ledger entry'],
        summary: 'Job job-mismatch-001: MISMATCH.',
      },
    });

    const summary = await detector.detectAndEscalate();

    expect(summary.mismatch).toBe(1);
    expect(summary.unverifiedLedgerEntries).toBe(1);
    expect(summary.escalated).toBe(0); // observe-only: no escalation
    expect(summary.observeOnly).toBe(true);
  });

  test('empty database produces no findings', async () => {
    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase([], [], {}),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({});

    const summary = await detector.detectAndEscalate();

    expect(summary.totalJobs).toBe(0);
    expect(summary.consistent).toBe(0);
    expect(summary.mismatch).toBe(0);
    expect(summary.escalated).toBe(0);
    expect(summary.unverifiedLedgerEntries).toBe(0);
  });

  // --- Mode-based exclusion tests ---
  // These verify the primary, permanent exclusion: test-mode records
  // (cs_test_* checkout sessions) are excluded even when their timestamp
  // is after the go_live_at boundary. This is the gap that the timestamp-only
  // boundary would have missed.

  test('a test-mode job (cs_test_) created AFTER the boundary is excluded', async () => {
    // This is the specific scenario that would have slipped through the
    // timestamp-only fix: a new test job created after go_live_at.
    const futureBoundary = '2020-01-01T00:00:00Z'; // boundary in the past — everything is "after" it
    const jobs = [{
      job_id: 'job-test-after-boundary',
      stripe_checkout_session_id: 'cs_test_newQualificationRun',
      created_at: new Date().toISOString(),
    }];
    const ledger = [{ verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}, { boundary: futureBoundary }),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({
      'job-test-after-boundary': {
        state: 'MISMATCH',
        jobId: 'job-test-after-boundary',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: ['SAFETY: Missing ledger entry'],
        summary: 'Job job-test-after-boundary: MISMATCH.',
      },
    });

    const summary = await detector.detectAndEscalate();

    // The test-mode job must be excluded — zero findings
    expect(summary.totalJobs).toBe(0);
    expect(summary.mismatch).toBe(0);
    expect(summary.escalated).toBe(0);
  });

  test('a live-mode job (cs_live_) created after the boundary IS checked', async () => {
    const futureBoundary = '2020-01-01T00:00:00Z';
    const jobs = [{
      job_id: 'job-live-after-boundary',
      stripe_checkout_session_id: 'cs_live_realCustomer123',
      created_at: new Date().toISOString(),
    }];
    const ledger = [{ verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}, { boundary: futureBoundary }),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({
      'job-live-after-boundary': {
        state: 'MISMATCH',
        jobId: 'job-live-after-boundary',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: ['SAFETY: Missing ledger entry'],
        summary: 'Job job-live-after-boundary: MISMATCH.',
      },
    });

    const summary = await detector.detectAndEscalate();

    // The live-mode job must be checked — it's a real customer
    expect(summary.totalJobs).toBe(1);
    expect(summary.mismatch).toBe(1);
    expect(summary.escalated).toBe(1);
  });

  test('a job with no checkout session ID is excluded (defensive)', async () => {
    const futureBoundary = '2020-01-01T00:00:00Z';
    const jobs = [{
      job_id: 'job-no-checkout',
      stripe_checkout_session_id: null,
      created_at: new Date().toISOString(),
    }];
    const ledger = [{ verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}, { boundary: futureBoundary }),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({});

    const summary = await detector.detectAndEscalate();

    // No checkout session = not a real live transaction = excluded
    expect(summary.totalJobs).toBe(0);
    expect(summary.escalated).toBe(0);
  });

  test('mix of test-mode and live-mode jobs — only live jobs are checked', async () => {
    const futureBoundary = '2020-01-01T00:00:00Z';
    const jobs = [
      { job_id: 'job-test-1', stripe_checkout_session_id: 'cs_test_abc', created_at: new Date().toISOString() },
      { job_id: 'job-live-1', stripe_checkout_session_id: 'cs_live_xyz', created_at: new Date().toISOString() },
      { job_id: 'job-test-2', stripe_checkout_session_id: 'cs_test_def', created_at: new Date().toISOString() },
      { job_id: 'job-live-2', stripe_checkout_session_id: 'cs_live_uvw', created_at: new Date().toISOString() },
    ];
    const ledger = [{ verified: true }];

    const detector = new RevenueReconciliationDetector({
      supabase: createMockSupabase(jobs, ledger, {}, { boundary: futureBoundary }),
      observeOnly: false,
    });

    (detector as any).reconciler = mockReconciler({
      'job-live-1': {
        state: 'MISMATCH',
        jobId: 'job-live-1',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: ['SAFETY: Missing ledger entry'],
        summary: 'Job job-live-1: MISMATCH.',
      },
      'job-live-2': {
        state: 'CONSISTENT',
        jobId: 'job-live-2',
        timestamp: new Date().toISOString(),
        correlation: {},
        stages: {},
        violations: [],
        summary: 'Job job-live-2: all stages PASS',
      },
    });

    const summary = await detector.detectAndEscalate();

    // Only the 2 live jobs are checked; the 2 test jobs are excluded
    expect(summary.totalJobs).toBe(2);
    expect(summary.mismatch).toBe(1); // job-live-1
    expect(summary.consistent).toBe(1); // job-live-2
    expect(summary.escalated).toBe(1); // only the mismatch
  });
});
