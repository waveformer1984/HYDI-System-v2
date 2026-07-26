'use strict';

const ConsoleRenderer = require('../../../src/hydi-v3/ConsoleRenderer');

describe('ConsoleRenderer', () => {
  const state = {
    briefingSections: { health: 'stable', sections: [{ id: 'x', title: 'Executive Summary', tone: 'primary', lines: ['All good.'] }] },
    approvals: [{
      id: 'a1', kind: 'workflow', title: 'Big deal', businessValue: 4000, risk: 0.3,
      responsibleAgent: 'Sales Manager', expectedImpact: 'Revenue growth',
    }],
    timeline: [{ id: 't1', at: Date.now(), category: 'workflow', summary: 'New workflow created' }],
    health: {
      revenue: { openOpportunities: 2, pipelineValue: 5000 },
      manufacturing: { activeEquipment: 1, needsMaintenance: 0 },
      research: { activeExperiments: 0, completedExperiments: 0 },
      creative: { activeProjects: 0, prototypes: 0 },
      financial: { revenue: 5000, expenses: 100, net: 4900 },
      dataGaps: ['Observability dashboard not connected.'],
    },
    agents: [
      { name: 'Sales Manager', available: true, headline: 'Follow up on 1 lead', confidence: 0.8, pendingCount: 1, riskCount: 0 },
      { name: 'Finance Analyst', available: false, reason: 'BusinessMemory not connected.' },
    ],
    commandPalette: [{ command: 'good morning', description: 'Generate the complete executive briefing.' }],
    sessionState: { focus: 'resonate', ownerPriority: 'resonate' },
  };

  test('renders a self-contained HTML document with all required panels', () => {
    const html = ConsoleRenderer.toHtml(state, { commandEndpoint: '/api/console/command' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Executive Briefing');
    expect(html).toContain('Approval Center');
    expect(html).toContain('Executive Timeline');
    expect(html).toContain('Business Health');
    expect(html).toContain('Agent Workspace');
    expect(html).toContain('Command Palette');
  });

  test('escapes untrusted content', () => {
    const malicious = {
      ...state,
      approvals: [{ ...state.approvals[0], title: '<script>alert(1)</script>' }],
    };
    const html = ConsoleRenderer.toHtml(malicious);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('renders agent unavailability reasons without fabricating data', () => {
    const html = ConsoleRenderer.toHtml(state);
    expect(html).toContain('BusinessMemory not connected.');
  });

  test('handles empty state gracefully', () => {
    const html = ConsoleRenderer.toHtml({});
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('No pending approvals');
  });
});
