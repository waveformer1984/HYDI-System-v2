/**
 * Qualification tests for the StuckJobDetector
 *
 * These tests verify the two critical scenarios:
 *   1. A genuinely stuck job gets recovered/escalated
 *   2. A normally-progressing job is left alone (no false positives)
 *
 * False positives here would be as bad as false completion was in the
 * payment templates — retrying a job that's actually progressing fine
 * would disrupt real work.
 *
 * These tests run against a mock Supabase client to avoid requiring
 * a live database. The mock simulates the customer_jobs and
 * customer_job_events tables.
 */

import { StuckJobDetector } from '../../lib/operational/StuckJobDetector';

// ─── Mock Supabase ───────────────────────────────────────────────────────

interface MockJob {
  job_id: string;
  job_status: string;
  customer_email: string;
  product: string;
  execution_started_at: string | null;
  execution_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MockEvent {
  id: string;
  job_id: string;
  event_type: string;
  actor: string;
  from_state: string | null;
  to_state: string;
  details: Record<string, unknown>;
}

function makeMockSupabase(jobs: MockJob[], events: MockEvent[] = []) {
  const jobTable = [...jobs];
  const eventTable = [...events];
  const escalationInserts: any[] = [];

  function makeChain(table: any[], tableName: string) {
    let query: any = {
      _filters: [] as Array<{ column: string; operator: string; value: any }>,
      _order: null as { column: string; ascending: boolean } | null,
      _limit: null as number | null,
      _select: '*',
      _count: null as 'exact' | null,
      _head: false,
      _updateData: null as any,
      _insertData: null as any | null,
    };

    const chain: any = {
      select(columns: string, opts?: any) {
        query._select = columns;
        if (opts?.count) query._count = opts.count;
        if (opts?.head) query._head = true;
        return chain;
      },
      eq(column: string, value: any) {
        query._filters.push({ column, operator: 'eq', value });
        return chain;
      },
      lt(column: string, value: any) {
        query._filters.push({ column, operator: 'lt', value });
        return chain;
      },
      order(column: string, opts: any) {
        query._order = { column, ascending: opts.ascending ?? true };
        return chain;
      },
      limit(n: number) {
        query._limit = n;
        return chain;
      },
      update(data: any) {
        query._updateData = data;
        return chain;
      },
      insert(data: any) {
        query._insertData = data;
        return chain;
      },
      then(resolve: any, reject?: any) {
        // Handle insert (for operator_escalations and customer_job_events)
        if (query._insertData) {
          if (tableName === 'operator_escalations') {
            escalationInserts.push(query._insertData);
            resolve({ data: query._insertData, error: null });
            return;
          }
          if (tableName === 'customer_job_events') {
            const newEvent: MockEvent = {
              id: `evt-${Date.now()}-${Math.random()}`,
              job_id: query._insertData.job_id,
              event_type: query._insertData.event_type,
              actor: query._insertData.actor,
              from_state: query._insertData.from_state,
              to_state: query._insertData.to_state,
              details: query._insertData.details || {},
            };
            eventTable.push(newEvent);
            resolve({ data: newEvent, error: null });
            return;
          }
        }

        // Handle update (for customer_jobs)
        if (query._updateData) {
          let updatedCount = 0;
          for (let i = 0; i < jobTable.length; i++) {
            const job = jobTable[i];
            let matches = true;
            for (const f of query._filters) {
              if (f.operator === 'eq' && (job as any)[f.column] !== f.value) {
                matches = false;
                break;
              }
            }
            if (matches) {
              Object.assign(job, query._updateData);
              updatedCount++;
            }
          }
          resolve({ data: null, error: null });
          return;
        }

        // Handle select with filters
        let result = [...table];

        // Apply filters
        for (const f of query._filters) {
          if (f.operator === 'eq') {
            result = result.filter(row => (row as any)[f.column] === f.value);
          } else if (f.operator === 'lt') {
            result = result.filter(row => {
              const val = (row as any)[f.column];
              if (val === null || val === undefined) return false;
              return new Date(val).getTime() < new Date(f.value).getTime();
            });
          }
        }

        // Apply ordering
        if (query._order) {
          result.sort((a, b) => {
            const av = (a as any)[query._order!.column];
            const bv = (b as any)[query._order!.column];
            const cmp = new Date(av).getTime() - new Date(bv).getTime();
            return query._order!.ascending ? cmp : -cmp;
          });
        }

        // Apply limit
        if (query._limit !== null) {
          result = result.slice(0, query._limit);
        }

        // Handle count-only queries (head: true)
        if (query._head && query._count === 'exact') {
          resolve({ data: null, error: null, count: result.length });
          return;
        }

        resolve({ data: result, error: null });
      },
      catch(reject: any) {
        // No-op — errors are handled in then()
      },
    };

    return chain;
  }

  const supabase: any = {
    from(tableName: string) {
      if (tableName === 'customer_jobs') return makeChain(jobTable, tableName);
      if (tableName === 'customer_job_events') return makeChain(eventTable, tableName);
      if (tableName === 'operator_escalations') return makeChain(escalationInserts, tableName);
      // Unknown table — return empty chain
      return makeChain([], tableName);
    },
  };

  return {
    supabase,
    jobTable,
    eventTable,
    escalationInserts,
  };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('StuckJobDetector: qualification scenarios', () => {
  // ─── Scenario 1: A genuinely stuck `executing` job gets retried ────────

  test('a job stuck in executing for 6 hours gets retried (executing → queued)', async () => {
    const stuckJob: MockJob = {
      job_id: 'job-stuck-001',
      job_status: 'executing',
      customer_email: 'customer@example.com',
      product: 'model-prep',
      execution_started_at: hoursAgo(6), // 6 hours ago — past the 4h threshold
      execution_completed_at: null,
      created_at: hoursAgo(8),
      updated_at: hoursAgo(6),
    };

    const { supabase, jobTable, eventTable } = makeMockSupabase([stuckJob]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(1);
    expect(result.retriesAttempted).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].jobId).toBe('job-stuck-001');
    expect(result.findings[0].recommendedAction).toBe('retry_execution');
    expect(result.findings[0].actionResult).toBe('success');

    // The job should have been transitioned to queued
    expect(jobTable[0].job_status).toBe('queued');
    expect(jobTable[0].execution_status).toBe('pending');
    expect(jobTable[0].execution_started_at).toBeNull();

    // A retry event should have been recorded
    const retryEvents = eventTable.filter(e => e.event_type === 'execution_retry');
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0].job_id).toBe('job-stuck-001');
    expect(retryEvents[0].from_state).toBe('executing');
    expect(retryEvents[0].to_state).toBe('queued');
  });

  // ─── Scenario 2: A normally-progressing `executing` job is left alone ──

  test('a job in executing for only 1 hour is left alone (no false positive)', async () => {
    const healthyJob: MockJob = {
      job_id: 'job-healthy-001',
      job_status: 'executing',
      customer_email: 'customer@example.com',
      product: 'model-prep',
      execution_started_at: hoursAgo(1), // 1 hour ago — under the 4h threshold
      execution_completed_at: null,
      created_at: hoursAgo(2),
      updated_at: hoursAgo(1),
    };

    const { supabase, jobTable, eventTable } = makeMockSupabase([healthyJob]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(0); // No stuck jobs found
    expect(result.retriesAttempted).toBe(0);
    expect(result.findings).toHaveLength(0);

    // The job should NOT have been modified
    expect(jobTable[0].job_status).toBe('executing');
    // execution_started_at should still be set (not nulled out by a retry)
    expect(jobTable[0].execution_started_at).not.toBeNull();

    // No retry events
    const retryEvents = eventTable.filter(e => e.event_type === 'execution_retry');
    expect(retryEvents).toHaveLength(0);
  });

  // ─── Scenario 3: A stale `awaiting_review` job gets escalated ──────────

  test('a job in awaiting_review for 72 hours gets escalated (not auto-delivered)', async () => {
    const staleJob: MockJob = {
      job_id: 'job-stale-review-001',
      job_status: 'awaiting_review',
      customer_email: 'customer@example.com',
      product: 'model-prep',
      execution_started_at: hoursAgo(80),
      execution_completed_at: hoursAgo(72), // 72 hours ago — past the 48h threshold
      created_at: hoursAgo(82),
      updated_at: hoursAgo(72),
    };

    const { supabase, jobTable, escalationInserts } = makeMockSupabase([staleJob]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(1);
    expect(result.escalationsSent).toBe(1);
    expect(result.retriesAttempted).toBe(0); // No retry for awaiting_review
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].jobId).toBe('job-stale-review-001');
    expect(result.findings[0].recommendedAction).toBe('escalate_review');
    expect(result.findings[0].actionResult).toBe('success');

    // The job should NOT have been modified (no auto-delivery)
    expect(jobTable[0].job_status).toBe('awaiting_review');

    // An escalation notification should have been written
    expect(escalationInserts.length).toBeGreaterThanOrEqual(1);
    expect(escalationInserts[0].category).toBe('stuck_job');
    expect(escalationInserts[0].severity).toBe('warning');
    expect(escalationInserts[0].title).toContain('awaiting review');
    expect(escalationInserts[0].metadata.jobId).toBe('job-stale-review-001');
  });

  // ─── Scenario 4: A recently completed `awaiting_review` job is left alone

  test('a job in awaiting_review for only 2 hours is left alone (no false positive)', async () => {
    const healthyJob: MockJob = {
      job_id: 'job-healthy-review-001',
      job_status: 'awaiting_review',
      customer_email: 'customer@example.com',
      product: 'model-prep',
      execution_started_at: hoursAgo(4),
      execution_completed_at: hoursAgo(2), // 2 hours ago — under the 48h threshold
      created_at: hoursAgo(5),
      updated_at: hoursAgo(2),
    };

    const { supabase, jobTable, escalationInserts } = makeMockSupabase([healthyJob]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(0);
    expect(result.escalationsSent).toBe(0);
    expect(result.findings).toHaveLength(0);

    // Job should not be modified
    expect(jobTable[0].job_status).toBe('awaiting_review');

    // No escalations
    expect(escalationInserts).toHaveLength(0);
  });

  // ─── Scenario 5: A job already retried once does NOT get retried again ─

  test('a stuck executing job that was already retried once gets escalated, not retried again', async () => {
    const stuckJob: MockJob = {
      job_id: 'job-already-retried-001',
      job_status: 'executing',
      customer_email: 'customer@example.com',
      product: 'model-prep',
      execution_started_at: hoursAgo(6),
      execution_completed_at: null,
      created_at: hoursAgo(10),
      updated_at: hoursAgo(6),
    };

    const priorRetryEvent: MockEvent = {
      id: 'evt-prior-retry',
      job_id: 'job-already-retried-001',
      event_type: 'execution_retry',
      actor: 'hydi:stuck-job-detector',
      from_state: 'executing',
      to_state: 'queued',
      details: { reason: 'Stuck in executing for 5h', retriedAt: hoursAgo(5) },
    };

    const { supabase, jobTable, eventTable, escalationInserts } = makeMockSupabase([stuckJob], [priorRetryEvent]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(1);
    expect(result.retriesAttempted).toBe(0); // No retry — already retried once
    expect(result.escalationsSent).toBe(1); // Escalated instead
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].recommendedAction).toBe('escalate_review');
    expect(result.findings[0].retryCount).toBe(1);

    // Job should NOT have been transitioned (no second retry)
    expect(jobTable[0].job_status).toBe('executing');

    // Only one retry event should exist (the prior one)
    const retryEvents = eventTable.filter(e => e.event_type === 'execution_retry');
    expect(retryEvents).toHaveLength(1); // Only the prior one
  });

  // ─── Scenario 6: A mix of stuck and healthy jobs — only stuck ones acted on

  test('a mix of stuck and healthy jobs — only stuck ones are acted on', async () => {
    const jobs: MockJob[] = [
      // Stuck executing (6h ago — past 4h threshold)
      {
        job_id: 'job-stuck-exec',
        job_status: 'executing',
        customer_email: 'a@example.com',
        product: 'model-prep',
        execution_started_at: hoursAgo(6),
        execution_completed_at: null,
        created_at: hoursAgo(8),
        updated_at: hoursAgo(6),
      },
      // Healthy executing (1h ago — under 4h threshold)
      {
        job_id: 'job-healthy-exec',
        job_status: 'executing',
        customer_email: 'b@example.com',
        product: 'model-prep',
        execution_started_at: hoursAgo(1),
        execution_completed_at: null,
        created_at: hoursAgo(2),
        updated_at: hoursAgo(1),
      },
      // Stale awaiting_review (72h ago — past 48h threshold)
      {
        job_id: 'job-stale-review',
        job_status: 'awaiting_review',
        customer_email: 'c@example.com',
        product: 'model-prep',
        execution_started_at: hoursAgo(80),
        execution_completed_at: hoursAgo(72),
        created_at: hoursAgo(82),
        updated_at: hoursAgo(72),
      },
      // Healthy awaiting_review (2h ago — under 48h threshold)
      {
        job_id: 'job-healthy-review',
        job_status: 'awaiting_review',
        customer_email: 'd@example.com',
        product: 'model-prep',
        execution_started_at: hoursAgo(4),
        execution_completed_at: hoursAgo(2),
        created_at: hoursAgo(5),
        updated_at: hoursAgo(2),
      },
      // Delivered job (should be ignored entirely)
      {
        job_id: 'job-delivered',
        job_status: 'delivered',
        customer_email: 'e@example.com',
        product: 'model-prep',
        execution_started_at: hoursAgo(100),
        execution_completed_at: hoursAgo(96),
        created_at: hoursAgo(102),
        updated_at: hoursAgo(96),
      },
    ];

    const { supabase, jobTable, escalationInserts } = makeMockSupabase(jobs);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(2); // Only the 2 stuck ones
    expect(result.retriesAttempted).toBe(1); // Only the stuck executing job
    expect(result.escalationsSent).toBe(1); // Only the stale awaiting_review job
    expect(result.findings).toHaveLength(2);

    // Verify the stuck executing job was retried
    const stuckExecJob = jobTable.find(j => j.job_id === 'job-stuck-exec');
    expect(stuckExecJob!.job_status).toBe('queued');

    // Verify the healthy executing job was NOT touched
    const healthyExecJob = jobTable.find(j => j.job_id === 'job-healthy-exec');
    expect(healthyExecJob!.job_status).toBe('executing');

    // Verify the stale awaiting_review job was NOT auto-delivered
    const staleReviewJob = jobTable.find(j => j.job_id === 'job-stale-review');
    expect(staleReviewJob!.job_status).toBe('awaiting_review');

    // Verify the healthy awaiting_review job was NOT touched
    const healthyReviewJob = jobTable.find(j => j.job_id === 'job-healthy-review');
    expect(healthyReviewJob!.job_status).toBe('awaiting_review');

    // Verify the delivered job was NOT touched
    const deliveredJob = jobTable.find(j => j.job_id === 'job-delivered');
    expect(deliveredJob!.job_status).toBe('delivered');
  });

  // ─── Scenario 7: Observe-only mode doesn't take action but still detects

  test('observe-only mode detects stuck jobs but does not retry or escalate', async () => {
    const stuckJob: MockJob = {
      job_id: 'job-stuck-observe',
      job_status: 'executing',
      customer_email: 'customer@example.com',
      product: 'model-prep',
      execution_started_at: hoursAgo(6),
      execution_completed_at: null,
      created_at: hoursAgo(8),
      updated_at: hoursAgo(6),
    };

    const { supabase, jobTable, eventTable, escalationInserts } = makeMockSupabase([stuckJob]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: false, // observe-only
      enableEscalation: false,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(1); // Still detected
    expect(result.retriesAttempted).toBe(0); // No action taken
    expect(result.escalationsSent).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].actionResult).toBe('skipped');

    // Job should NOT have been modified
    expect(jobTable[0].job_status).toBe('executing');

    // No retry events or escalations
    expect(eventTable.filter(e => e.event_type === 'execution_retry')).toHaveLength(0);
    expect(escalationInserts).toHaveLength(0);
  });

  // ─── Scenario 8: Empty database — no jobs at all ───────────────────────

  test('no jobs in the database — detection returns zero findings', async () => {
    const { supabase } = makeMockSupabase([]);
    const detector = new StuckJobDetector(supabase, {
      executingThresholdHours: 4,
      awaitingReviewThresholdHours: 48,
      enableRetry: true,
      enableEscalation: true,
    });

    const result = await detector.detectAndRecover();

    expect(result.error).toBeUndefined();
    expect(result.stuckJobsFound).toBe(0);
    expect(result.retriesAttempted).toBe(0);
    expect(result.escalationsSent).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.checkedJobs).toBe(0);
  });
});
