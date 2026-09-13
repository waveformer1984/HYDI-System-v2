'use strict';

const { buildBriefing } = require('../../lib/missions/briefing');

function opp(overrides = {}) {
  return {
    title: 'Sample opportunity',
    why_it_matters: 'it matters',
    required_action: 'do the thing',
    estimated_value: 'unknown',
    confidence: 50,
    status: 'needs_review',
    evidence: [{ source_url: 'https://example.com' }],
    ...overrides,
  };
}

describe('briefing: buildBriefing', () => {
  it('matches the requested PROTOFORGE DAILY BRIEF format', () => {
    const text = buildBriefing([
      opp({ title: 'A', confidence: 96, status: 'high_confidence', required_action: 'Contact X' }),
    ]);
    expect(text).toContain('PROTOFORGE DAILY BRIEF');
    expect(text).toContain('Opportunities found: 1');
    expect(text).toContain('High-confidence:      1');
    expect(text).toContain('Needs review:         0');
    expect(text).toContain('Rejected:             0');
    expect(text).toContain('TOP OPPORTUNITIES');
    expect(text).toContain('1. [A]');
    expect(text).toContain('Why it matters:');
    expect(text).toContain('Evidence:');
    expect(text).toContain('Estimated value:');
    expect(text).toContain('Required action:');
    expect(text).toContain('Confidence: 96%');
    expect(text).toContain('RECOMMENDED NEXT ACTION');
    expect(text).toContain('→ Contact X');
    expect(text).toContain('Human approval required: YES');
  });

  it('counts high-confidence, needs-review and rejected independently of the top-N list', () => {
    const text = buildBriefing([
      opp({ status: 'high_confidence', confidence: 80 }),
      opp({ status: 'high_confidence', confidence: 75 }),
      opp({ status: 'needs_review', confidence: 40 }),
      opp({ status: 'rejected', confidence: 5 }),
      opp({ status: 'rejected', confidence: 3 }),
      opp({ status: 'rejected', confidence: 1 }),
    ]);
    expect(text).toContain('Opportunities found: 6');
    expect(text).toContain('High-confidence:      2');
    expect(text).toContain('Needs review:         1');
    expect(text).toContain('Rejected:             3');
  });

  it('handles an empty queue without crashing or fabricating a fake opportunity', () => {
    const text = buildBriefing([]);
    expect(text).toContain('Opportunities found: 0');
    expect(text).toContain('(none)');
    expect(text).toContain('No opportunities cleared review this run.');
  });

  it('always requires human approval, even for a single high-confidence hit', () => {
    const text = buildBriefing([opp({ status: 'high_confidence', confidence: 99 })]);
    expect(text).toContain('Human approval required: YES');
  });

  it('sorts TOP OPPORTUNITIES by confidence descending regardless of input order', () => {
    const text = buildBriefing([
      opp({ title: 'Low', confidence: 20 }),
      opp({ title: 'High', confidence: 90, status: 'high_confidence' }),
      opp({ title: 'Mid', confidence: 50 }),
    ]);
    const iHigh = text.indexOf('[High]');
    const iMid = text.indexOf('[Mid]');
    const iLow = text.indexOf('[Low]');
    expect(iHigh).toBeGreaterThan(-1);
    expect(iHigh).toBeLessThan(iMid);
    expect(iMid).toBeLessThan(iLow);
  });

  it('respects topN', () => {
    const many = Array.from({ length: 10 }, (_, i) => opp({ title: `O${i}`, confidence: i }));
    const text = buildBriefing(many, { topN: 3 });
    const matches = text.match(/^\d+\. \[/gm) || [];
    expect(matches).toHaveLength(3);
  });
});
