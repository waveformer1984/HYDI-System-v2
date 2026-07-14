/**
 * Unit tests for revenue-engine/reality-filter.js's DB-backed helper
 * methods, which previously returned Math.random()-based fake values
 * (getConversionRate excepted -- it already had a fixed lookup table but
 * ignored real lead history). Pricing/quote/product-listing decisions
 * should be deterministic given the same underlying data.
 */

'use strict';

const RealityFilter = require('../../revenue-engine/reality-filter');

// Supabase's query builder is "thenable" -- chain methods return the
// builder itself, and awaiting the chain resolves via .then(). This lets
// tests configure a fixed result per query.
function makeQueryBuilder(result) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    not: jest.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

function makeSupabase(tableResults) {
  return {
    from: jest.fn((table) => makeQueryBuilder(tableResults[table] ?? { data: [], error: null })),
  };
}

describe('RealityFilter - getConversionRate', () => {
  it('computes a real ratio from lead history when data exists', async () => {
    const supabase = makeSupabase({
      leads: {
        data: [{ converted_at: '2026-01-01' }, { converted_at: null }, { converted_at: null }],
        error: null,
      },
    });
    const filter = new RealityFilter(supabase);
    await expect(filter.getConversionRate('linkedin')).resolves.toBeCloseTo(1 / 3, 5);
  });

  it('falls back to the known-source baseline when there is no history yet', async () => {
    const supabase = makeSupabase({ leads: { data: [], error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getConversionRate('referral')).resolves.toBe(0.15);
  });

  it('falls back to a conservative default for an unknown source with no history', async () => {
    const supabase = makeSupabase({ leads: { data: [], error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getConversionRate('mystery_source')).resolves.toBe(0.01);
  });
});

describe('RealityFilter - getNewSourcesToday', () => {
  it('counts distinct sources not already in the allowed list', async () => {
    const supabase = makeSupabase({
      leads: {
        data: [{ source: 'linkedin' }, { source: 'tiktok_dm' }, { source: 'tiktok_dm' }, { source: 'cold_call' }],
        error: null,
      },
    });
    const filter = new RealityFilter(supabase);
    // linkedin is already allowed; tiktok_dm and cold_call are new -> 2
    await expect(filter.getNewSourcesToday()).resolves.toBe(2);
  });
});

describe('RealityFilter - getNicheSaturation', () => {
  it('returns 0 for an unexplored niche', async () => {
    const supabase = makeSupabase({ leads: { data: [], error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getNicheSaturation('quantum_widgets')).resolves.toBe(0);
  });

  it('computes engagement ratio for a niche with history', async () => {
    const supabase = makeSupabase({
      leads: {
        data: [{ status: 'converted' }, { status: 'contacted' }, { status: 'new' }, { status: 'new' }],
        error: null,
      },
    });
    const filter = new RealityFilter(supabase);
    await expect(filter.getNicheSaturation('3d_printing')).resolves.toBeCloseTo(0.5, 5);
  });
});

describe('RealityFilter - count-based helpers', () => {
  it('getOutreachCountToday reads the real count', async () => {
    const supabase = makeSupabase({ outreach: { count: 7, error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getOutreachCountToday()).resolves.toBe(7);
  });

  it('getProductListingsToday reads the real count', async () => {
    const supabase = makeSupabase({ product_listings: { count: 2, error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getProductListingsToday()).resolves.toBe(2);
  });

  it('getConcurrentTaskCount reads the real count', async () => {
    const supabase = makeSupabase({ task_queue: { count: 4, error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getConcurrentTaskCount()).resolves.toBe(4);
  });

  it('count helpers default to 0 when the query returns no count', async () => {
    const supabase = makeSupabase({ outreach: { count: null, error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getOutreachCountToday()).resolves.toBe(0);
  });
});

describe('RealityFilter - calculateLeadRelevance', () => {
  it('averages the real lead.score field, not a random guess', async () => {
    const filter = new RealityFilter(makeSupabase({}));
    const leads = [{ score: 80 }, { score: 40 }];
    await expect(filter.calculateLeadRelevance(leads)).resolves.toBeCloseTo(0.6, 5);
  });

  it('returns 0 for an empty lead list', async () => {
    const filter = new RealityFilter(makeSupabase({}));
    await expect(filter.calculateLeadRelevance([])).resolves.toBe(0);
  });
});

describe('RealityFilter - getDemandScore', () => {
  it('uses the caller-provided trendScore when given, over historical data', async () => {
    const supabase = makeSupabase({});
    const filter = new RealityFilter(supabase);
    await expect(filter.getDemandScore('gadgets', 90)).resolves.toBeCloseTo(0.9, 5);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('falls back to the category average trend_score when no trendScore is given', async () => {
    const supabase = makeSupabase({
      product_ideas: { data: [{ trend_score: 60 }, { trend_score: 80 }], error: null },
    });
    const filter = new RealityFilter(supabase);
    await expect(filter.getDemandScore('gadgets')).resolves.toBeCloseTo(0.7, 5);
  });

  it('returns a neutral 0.5 for a category with no history and no trendScore', async () => {
    const supabase = makeSupabase({ product_ideas: { data: [], error: null } });
    const filter = new RealityFilter(supabase);
    await expect(filter.getDemandScore('unknown_category')).resolves.toBe(0.5);
  });
});
