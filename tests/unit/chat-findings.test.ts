/**
 * /api/chat findings intent — substantive durable agent evidence.
 *
 * Regression for the gap where `what did the agents find` reported only
 * execution metadata ("mission X completed") and dropped the substantive
 * result fields the agents actually persisted (subject, source counts,
 * analyst agreement, mission IDs). The answer must come from durable
 * agent_status/agent_message evidence — never the conversational model,
 * and it must stay read-only.
 */
jest.mock('../../lib/heidi-agent', () => ({ runHeidiAgentStream: jest.fn() }));
jest.mock('../../lib/claude', () => ({ isClaudeAvailable: () => false }));

// Chainable fake timed client: records eq() filters per query and resolves
// with the row set matching the durable evidence the query targets.
let mockStatusRows: Array<Record<string, unknown>> = [];
let mockMessageRows: Array<Record<string, unknown>> = [];

jest.mock('../../lib/supabase-timed', () => ({
  createTimedClient: jest.fn(() => ({
    from: (_table: string) => {
      const filters: Array<[string, unknown]> = [];
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return q; },
        order: () => q,
        limit: () => q,
        then: (cb: (r: { data: unknown[]; error: null }) => void) => {
          const wantsStatus = filters.some(([c, v]) => c === 'payload->>status' && v === 'COMPLETED');
          const data = wantsStatus ? mockStatusRows : mockMessageRows;
          return Promise.resolve(cb({ data, error: null }));
        },
      };
      return q;
    },
  })),
}));

process.env.HYDI_SERVICE_SECRET = 'chat-findings-test-secret';

import handler from '../../pages/api/chat';

function mockRes() {
  const chunks: string[] = [];
  return {
    chunks,
    writeHead: jest.fn(),
    write: (s: string) => { chunks.push(s); return true; },
    end: jest.fn(),
    status: jest.fn(function (this: any) { return this; }),
    json: jest.fn(function (this: any) { return this; }),
    text: () => chunks.join(''),
  } as any;
}

const req = (body: object) => ({ method: 'POST', body, headers: {} }) as any;

const JIGA = 'Jiga (YC W21) — faster custom parts for hardware products';
const OPP = '05d91afa-73ff-49e0-807b-adab80c2036c';

beforeEach(() => {
  mockStatusRows = [
    // Coordinator completing last — carries the provenance link to its
    // child missions via result.children.
    {
      payload: {
        agentId: 'agent-analyst-parent', missionId: 'mission-parent', status: 'COMPLETED',
        result: { children: ['mission-cc', 'mission-bb', 'mission-aa'], status: 'COMPLETED' },
        evidence: []
      }, created_at: '2026-10-05T13:54:34Z'
    },
    {
      payload: {
        agentId: 'agent-analyst-cc', missionId: 'mission-cc', status: 'COMPLETED',
        result: { summary: 'analyzed 2 sibling result(s)', agreement: true, siblingCount: 2, subjectTitle: JIGA },
        evidence: []
      }, created_at: '2026-10-05T13:49:38Z'
    },
    {
      payload: {
        agentId: 'agent-research-bb', missionId: 'mission-bb', status: 'COMPLETED',
        result: { sourceCount: 5, confidence: '45', subjectTitle: JIGA },
        evidence: [{ opportunity: { id: OPP, title: JIGA } }]
      }, created_at: '2026-10-05T13:49:38Z'
    },
    {
      payload: {
        agentId: 'agent-research-aa', missionId: 'mission-aa', status: 'COMPLETED',
        result: { sourceCount: 2, confidence: '45', subjectTitle: JIGA },
        evidence: [{ opportunity: { id: OPP, title: JIGA } }]
      }, created_at: '2026-10-05T13:49:37Z'
    },
    // Decoys — older completed missions that share no provenance link.
    {
      payload: {
        agentId: 'agent-research-old', missionId: 'mission-old', status: 'COMPLETED',
        result: { sourceCount: 3, subjectTitle: JIGA },
        evidence: []
      }, created_at: '2026-09-28T13:37:51Z'
    },
    {
      payload: {
        agentId: 'team-qa', missionId: 'mission-team', status: 'COMPLETED',
        result: {}, evidence: []
      }, created_at: '2026-09-26T21:54:24Z'
    },
  ];
  mockMessageRows = [];
});

describe('/api/chat findings', () => {
  it('reports substantive durable evidence, not just completion status', async () => {
    const res = mockRes();
    await handler(req({ message: 'what did the agents find', session_id: 's', user_id: 'j' }), res);
    const out = res.text();
    expect(out).toContain('"model_used":"heidi-context"');
    expect(out).toContain(JIGA);
    expect(out).toContain('(05d91afa)');
    expect(out).toContain('research-bb: 5 sources [mission-bb]');
    expect(out).toContain('research-aa: 2 sources [mission-aa]');
    expect(out).toContain('agreement=true across 2 sibling result(s)');
    expect(out).toContain('coordinated 3 agents');
    expect(out).toContain('missions: mission-parent, mission-cc');
    // Provenance: unrelated completed missions must not leak into the answer.
    expect(out).not.toContain('mission-old');
    expect(out).not.toContain('team-qa');
    expect(out).not.toContain('AUTHORIZATION_REQUIRED');
  });

  it('is read-only — no service token required', async () => {
    // req() carries no x-hydi-service-token; findings must still answer.
    const res = mockRes();
    await handler(req({ message: 'what did the agents find', session_id: 's', user_id: 'j' }), res);
    expect(res.text()).not.toContain('AUTHORIZATION_REQUIRED');
  });

  it('answers honestly when no durable agent evidence exists', async () => {
    mockStatusRows = [];
    const res = mockRes();
    await handler(req({ message: 'what did the agents find', session_id: 's', user_id: 'j' }), res);
    expect(res.text()).toContain('No agent results yet');
    expect(res.text()).not.toContain('Jiga');
  });
});
