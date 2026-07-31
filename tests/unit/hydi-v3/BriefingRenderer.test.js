'use strict';

const BriefingRenderer = require('../../../src/hydi-v3/BriefingRenderer');

function makeBriefing(overrides = {}) {
  return {
    generatedAt: 1700000000000,
    executiveSummary: 'ProtoForge is stable. 1 priority action.',
    strategicObjectives: [
      { id: 'resonate', name: 'Resonate', activeEntities: 3, completedEntities: 1, health: 'good' },
    ],
    protoForgeStatus: { memoryConnected: true },
    priorityActions: [
      { id: 'e1', name: 'Big Deal', type: 'opportunity', value: 5000, score: 0.8123, reason: 'Revenue opportunity worth 5000' },
    ],
    risks: [
      { severity: 'medium', category: 'equipment', entity: 'eq1', name: 'Printer', detail: 'Status: maintenance' },
      { severity: 'high', category: 'deadline', entity: 'p1', name: 'Late Project', detail: 'Deadline passed' },
    ],
    recommendations: [
      { action: 'Complete "Big Deal"', reason: 'Highest score', expectedImpact: 'Revenue' },
    ],
    resonateStatus: {
      tracked: true,
      objectiveId: 'resonate',
      name: 'Resonate',
      progress: 0.5,
      blockers: [{ id: 'b1', name: 'Audio engine crash', reason: 'Unresolved defect' }],
      milestones: [],
      opportunities: [],
      customerSignals: 2,
      releaseReady: false,
    },
    missingData: ['Observability dashboard not connected.'],
    agentReports: {
      'Sales Manager': { openOpportunities: 2, pipelineValue: 7000, activeLeads: 1, activeCustomers: 3 },
      'Operations Manager': { activeTaskCount: 4, blockedTaskCount: 1 },
      'Manufacturing Manager': { activeEquipment: 2, needsMaintenance: ['Printer'] },
      'Research Manager': { activeExperiments: 1, completedExperiments: 5 },
      'Creative Director': { activeCreativeProjects: 2, prototypeCount: 6 },
      'Finance Analyst': { revenueOpportunityValue: 7000, trackedExpenses: 1200, projectedNet: 5800 },
    },
    ...overrides,
  };
}

describe('BriefingRenderer', () => {
  test('rejects a non-object briefing', () => {
    expect(() => BriefingRenderer.toSections(null)).toThrow('requires a briefing object');
    expect(() => BriefingRenderer.toText('nope')).toThrow('requires a briefing object');
  });

  test('produces every expected section in a stable order', () => {
    const model = BriefingRenderer.toSections(makeBriefing());
    expect(model.sections.map((s) => s.id)).toEqual([
      'executive-summary',
      'recent-activity',
      'strategic-objectives',
      'flagship-status',
      'operations',
      'sales',
      'manufacturing',
      'research',
      'creative',
      'financial',
      'risks',
      'opportunities',
      'recommendations',
      'learning-summary',
      'business-evidence',
      'missing-data',
    ]);
  });

  test('derives health from the risk list only', () => {
    expect(BriefingRenderer.healthOf(makeBriefing())).toBe('degraded');
    expect(BriefingRenderer.healthOf(makeBriefing({ risks: [{ severity: 'medium', name: 'x', detail: 'y' }] }))).toBe('watch');
    expect(BriefingRenderer.healthOf(makeBriefing({ risks: [] }))).toBe('stable');
  });

  test('sorts risks with high severity first', () => {
    const model = BriefingRenderer.toSections(makeBriefing());
    const risks = model.sections.find((s) => s.id === 'risks');
    expect(risks.lines[0]).toContain('[high]');
    expect(risks.lines[1]).toContain('[medium]');
    expect(risks.tone).toBe('danger');
  });

  test('does not mutate the briefing when sorting risks', () => {
    const briefing = makeBriefing();
    BriefingRenderer.toSections(briefing);
    expect(briefing.risks[0].severity).toBe('medium');
  });

  test('text rendering includes headers and key content', () => {
    const text = BriefingRenderer.toText(makeBriefing());
    expect(text).toContain('ProtoForge status: degraded.');
    expect(text).toContain('=== Executive Summary ===');
    expect(text).toContain('=== Critical Risks ===');
    expect(text).toContain('=== Top Opportunities ===');
    expect(text).toContain('=== Recommended Actions ===');
    expect(text).toContain('Big Deal');
    expect(text).toContain('score 0.81');
  });

  test('flagship section is titled from the objective and lists blockers', () => {
    const text = BriefingRenderer.toText(makeBriefing());
    expect(text).toContain('=== Resonate Status ===');
    expect(text).toContain('Progress 50%');
    expect(text).toContain('Blocker: Audio engine crash');
  });

  test('handles an untracked flagship and empty collections', () => {
    const text = BriefingRenderer.toText(makeBriefing({
      resonateStatus: { tracked: false },
      risks: [],
      priorityActions: [],
      recommendations: [],
      strategicObjectives: [],
      missingData: [],
    }));
    expect(text).toContain('=== Flagship Status ===');
    expect(text).toContain('Flagship product is not tracked in memory yet.');
    expect(text).toContain('None identified.');
    expect(text).toContain('No scored opportunities available.');
    expect(text).toContain('No specific recommendations.');
    expect(text).toContain('All expected data sources available.');
  });

  test('handles a briefing with no agent reports at all', () => {
    const text = BriefingRenderer.toText(makeBriefing({ agentReports: {} }));
    expect(text).toContain('Active tasks: 0, blocked: 0.');
    expect(text).toContain('projected net: 0.');
  });

  test('ANSI rendering carries the same information as plain text', () => {
    const briefing = makeBriefing();
    const ansi = BriefingRenderer.toAnsi(briefing);
    const stripped = ansi.replace(new RegExp(String.fromCharCode(0x1b) + '\\[\\d+m', 'g'), '');
    const plain = BriefingRenderer.toText(briefing);

    for (const section of BriefingRenderer.toSections(briefing).sections) {
      expect(stripped).toContain(section.title);
      for (const line of section.lines) {
        expect(stripped).toContain(line);
        expect(plain).toContain(line);
      }
    }
  });

  test('ANSI colour can be disabled', () => {
    const plainAnsi = BriefingRenderer.toAnsi(makeBriefing(), { colour: false });
    expect(new RegExp(String.fromCharCode(0x1b) + '\\[').test(plainAnsi)).toBe(false);
  });

  test('HTML rendering is well-formed and includes every section', () => {
    const briefing = makeBriefing();
    const html = BriefingRenderer.toHtml(briefing);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trim().endsWith('</html>')).toBe(true);
    for (const section of BriefingRenderer.toSections(briefing).sections) {
      expect(html).toContain(`id="${section.id}"`);
      expect(html).toContain(section.title);
    }
    expect(html).toContain('class="health degraded"');
  });

  test('HTML escapes untrusted briefing content', () => {
    const html = BriefingRenderer.toHtml(makeBriefing({
      priorityActions: [{ id: 'x', name: '<script>alert(1)</script>', score: 1, reason: 'a & b' }],
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('a &amp; b');
  });

  test('command console is only emitted when an endpoint is supplied', () => {
    expect(BriefingRenderer.toHtml(makeBriefing())).not.toContain('cockpit-form');
    const withConsole = BriefingRenderer.toHtml(makeBriefing(), { commandEndpoint: '/api/cockpit/command' });
    expect(withConsole).toContain('cockpit-form');
    expect(withConsole).toContain('/api/cockpit/command');
  });

  test('escapeHtml handles null and undefined', () => {
    expect(BriefingRenderer.escapeHtml(null)).toBe('');
    expect(BriefingRenderer.escapeHtml(undefined)).toBe('');
    expect(BriefingRenderer.escapeHtml('"x"')).toBe('&quot;x&quot;');
  });

  test('non-numeric scores do not produce NaN output', () => {
    const text = BriefingRenderer.toText(makeBriefing({
      priorityActions: [{ id: 'x', name: 'Unscored', score: undefined, reason: 'no score' }],
    }));
    expect(text).toContain('score 0.00');
    expect(text).not.toContain('NaN');
  });
});
