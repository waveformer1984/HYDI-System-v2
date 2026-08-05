/**
 * Unit tests for revenue-engine/revenue-engine-v2.js's `executeTask()`.
 *
 * Written to close the follow-up flagged in ISSUES_FOUND.md #74(b). That pass
 * found -- via lint, not via a test -- that the success path referenced a bare
 * `filterScore` that was never declared in scope (only `filterResult.score`
 * exists), so every *successful* task completion threw a ReferenceError. The
 * bug was fixed, but the file had no test file at all, meaning nothing would
 * catch the same class of regression.
 *
 * `executeTask()` is the funnel every revenue task passes through, and it has
 * four distinct exits: blocked by the Reality Filter, execution threw,
 * CASCADE-killed, and success. Each is covered here, with the returned
 * `filterScore`/`cascadeScore` asserted explicitly -- those assertions are
 * what actually pin the #74(b) regression, since a re-broken success path
 * fails on the ReferenceError before it can return.
 *
 * The module instantiates Supabase and Stripe clients at require() time from
 * environment variables, so both are mocked; no network or credentials are
 * involved.
 */

'use strict';

// --- Module mocks. Must be registered before the module under test loads. ---

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ data: [], error: null }),
      select: jest.fn().mockResolvedValue({ data: [], error: null }),
    })),
  })),
}));

jest.mock('stripe', () => jest.fn(() => ({})));

jest.mock('../../lib/structured-logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// The Reality Filter is the collaborator that decides whether a task runs at
// all and that learns from the outcome, so each test drives it directly.
const mockFilterTask = jest.fn();
const mockLearnFromOutcome = jest.fn();
jest.mock('../../revenue-engine/reality-filter', () =>
  jest.fn(() => ({
    filterTask: mockFilterTask,
    learnFromOutcome: mockLearnFromOutcome,
  })),
);

const RevenueEngineV2 = require('../../revenue-engine/revenue-engine-v2');

/** Reality Filter verdict allowing a task through with a known score. */
function allow(score = 0.75) {
  return { allowed: true, reason: 'looks viable', score };
}

/** Reality Filter verdict blocking a task. */
function block(reason = 'no evidence of demand', score = 0.1) {
  return { allowed: false, reason, score };
}

describe('RevenueEngineV2.executeTask', () => {
  let engine;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLearnFromOutcome.mockResolvedValue(undefined);
    engine = new RevenueEngineV2();
  });

  describe('success path (ISSUES_FOUND.md #74(b) regression)', () => {
    beforeEach(() => {
      mockFilterTask.mockResolvedValue(allow(0.75));
      // A healthy result: scoreTaskForCascade gives scrape_leads 0.8 when at
      // least one lead came back, comfortably above its 0.3 kill threshold.
      jest.spyOn(engine, 'scrapeLeads').mockResolvedValue({
        leads: [{ id: 'lead_1' }, { id: 'lead_2' }],
      });
    });

    it('completes without throwing and reports the completed stage', async () => {
      const result = await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(result.success).toBe(true);
      expect(result.stage).toBe('completed');
    });

    it('returns the filter score from filterResult rather than an undeclared binding', async () => {
      // The exact assertion the old code could not reach: it threw
      // `ReferenceError: filterScore is not defined` while building this object.
      const result = await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(result.filterScore).toBe(0.75);
      expect(result.cascadeScore).toBe(0.8);
    });

    it('passes the task result through untouched', async () => {
      const result = await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(result.result).toEqual({ leads: [{ id: 'lead_1' }, { id: 'lead_2' }] });
    });

    it('reports success to the Reality Filter so it can learn', async () => {
      await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(mockLearnFromOutcome).toHaveBeenCalledTimes(1);
      expect(mockLearnFromOutcome.mock.calls[0][2]).toMatchObject({ success: true });
    });

    it('updates metrics for the completed task', async () => {
      await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(engine.metrics.tasksAllowed).toBe(1);
      expect(engine.metrics.leadsScraped).toBe(2);
      expect(engine.metrics.tasksBlocked).toBe(0);
      expect(engine.metrics.cascadeKilled).toBe(0);
    });
  });

  describe('blocked by the Reality Filter', () => {
    beforeEach(() => {
      mockFilterTask.mockResolvedValue(block('no evidence of demand', 0.1));
    });

    it('returns a blocked result at the reality_filter stage', async () => {
      const result = await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(result).toMatchObject({
        success: false,
        blocked: true,
        reason: 'no evidence of demand',
        filterScore: 0.1,
        stage: 'reality_filter',
      });
    });

    it('never runs the task when it is blocked', async () => {
      const scrapeLeads = jest.spyOn(engine, 'scrapeLeads');

      await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(scrapeLeads).not.toHaveBeenCalled();
    });

    it('tallies the block reason so repeat blocks are visible', async () => {
      await engine.executeTask('scrape_leads', { niche: 'hvac' });
      await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(engine.metrics.tasksBlocked).toBe(2);
      expect(engine.metrics.filterBlockReasons.get('no evidence of demand')).toBe(2);
    });
  });

  describe('task execution throws', () => {
    beforeEach(() => {
      mockFilterTask.mockResolvedValue(allow(0.6));
    });

    it('returns the error at the execution stage instead of propagating', async () => {
      jest.spyOn(engine, 'scrapeLeads').mockRejectedValue(new Error('upstream 503'));

      const result = await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(result).toMatchObject({
        success: false,
        error: 'upstream 503',
        filterScore: 0.6,
        stage: 'execution',
      });
    });

    it('reports the failure to the Reality Filter so it can learn', async () => {
      jest.spyOn(engine, 'scrapeLeads').mockRejectedValue(new Error('upstream 503'));

      await engine.executeTask('scrape_leads', { niche: 'hvac' });

      expect(mockLearnFromOutcome.mock.calls[0][2]).toMatchObject({
        success: false,
        reason: 'upstream 503',
      });
    });

    it('treats an unknown task type as an execution failure', async () => {
      const result = await engine.executeTask('not_a_real_task', {});

      expect(result.success).toBe(false);
      expect(result.stage).toBe('execution');
      expect(result.error).toMatch(/Unknown task type/);
    });
  });

  describe('killed by CASCADE', () => {
    beforeEach(() => {
      mockFilterTask.mockResolvedValue(allow(0.5));
    });

    it('kills a task scoring below its threshold', async () => {
      // create_quote scores 0.3 when `total` is not positive, under its 0.4
      // threshold -- the one task type whose threshold exceeds the 0.3 default.
      jest.spyOn(engine, 'createInstantQuote').mockResolvedValue({ total: 0 });

      const result = await engine.executeTask('create_quote', { sqft: 1200 });

      expect(result).toMatchObject({
        success: false,
        cascadeKilled: true,
        filterScore: 0.5,
        cascadeScore: 0.3,
        stage: 'cascade',
      });
      expect(engine.metrics.cascadeKilled).toBe(1);
    });

    it('lets a task scoring above its threshold through', async () => {
      jest.spyOn(engine, 'createInstantQuote').mockResolvedValue({ total: 4200 });

      const result = await engine.executeTask('create_quote', { sqft: 1200 });

      expect(result.success).toBe(true);
      expect(result.cascadeScore).toBe(0.85);
      expect(engine.metrics.cascadeKilled).toBe(0);
      expect(engine.metrics.checkoutsCreated).toBe(1);
    });

    it('reports the kill to the Reality Filter so it can learn', async () => {
      jest.spyOn(engine, 'createInstantQuote').mockResolvedValue({ total: 0 });

      await engine.executeTask('create_quote', { sqft: 1200 });

      expect(mockLearnFromOutcome.mock.calls[0][2]).toMatchObject({
        success: false,
        reason: 'CASCADE: Performance below threshold',
      });
    });
  });
});
