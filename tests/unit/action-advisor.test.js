'use strict';

/**
 * Phase 2 — contract-layer action advisor (lib/governance/action-advisor.js).
 *
 * Proves the triple gate fails closed in every required mode and that, with
 * HEIDI_ALLOW_EXEC off, every proposal ends 'would have executed' or
 * 'blocked' — never executed, never AUTO-APPROVED past a refusal.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  adviseProposal,
  parseAdvisorVerdict,
  evaluateBoundsGate,
  VERDICTS,
} = require('../../lib/governance/action-advisor');

const BOUNDS = {
  auto_approve_threshold: 0.85,
  max_auto_approve_amount: 100,
  unattended_enabled: false,
  denied_resolvers: [],
  denied_capabilities: [],
};

function makeDeps(overrides = {}) {
  const events = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-log-'));
  return {
    events,
    gateLogPath: path.join(dir, 'gate-log.json'),
    recordEvent: async (row) => { events.push(row); },
    callModel: async () => JSON.stringify({ verdict: 'AUTO-APPROVE', confidence: 0.95, reason: 'in bounds, reversible' }),
    ...overrides,
  };
}

const GOOD = {
  proposal: { type: 'operational_decision', division: 'ops', payload: { action: 'restart-module heidi-core' }, proposer: 'test' },
  bounds: BOUNDS,
  execEnabled: 'false',
};

describe('parseAdvisorVerdict', () => {
  it('parses a clean verdict', () => {
    expect(parseAdvisorVerdict('{"verdict":"AUTO-APPROVE","confidence":0.9,"reason":"ok"}'))
      .toMatchObject({ verdict: 'AUTO-APPROVE', confidence: 0.9 });
  });
  it('parses verdict embedded in prose', () => {
    expect(parseAdvisorVerdict('Here you go: {"verdict":"BLOCK","confidence":0.1} done').verdict).toBe('BLOCK');
  });
  it.each(['', 'no json here', '{"verdict":"MAYBE","confidence":0.5}', '{"verdict":"AUTO-APPROVE"}', '{"verdict":"AUTO-APPROVE","confidence":1.7}', 'not json {'])(
    'rejects malformed output: %s', (text) => {
      expect(parseAdvisorVerdict(text)).toBeNull();
    });
});

describe('adviseProposal — gate outcomes', () => {
  it('in-bounds AUTO-APPROVE with exec off -> would have executed', async () => {
    const d = makeDeps();
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('would have executed');
    expect(r.verdict).toBe('AUTO-APPROVE');
    expect(r.gates.advisor.status).toBe('ok');
    expect(r.gates.bounds.pass).toBe(true);
    expect(r.execEnabled).toBe(false);
  });

  it('exec on + all gates -> authorized (module still never executes)', async () => {
    const d = makeDeps();
    const r = await adviseProposal({ ...GOOD, execEnabled: 'true', ...d });
    expect(r.outcome).toBe('authorized');
    expect(r.verdict).toBe('AUTO-APPROVE');
  });

  it('out-of-bounds amount -> blocked', async () => {
    const d = makeDeps();
    const r = await adviseProposal({
      ...GOOD,
      proposal: { type: 'financial_approval', division: 'ops', payload: { amount: 500 } },
      ...d,
    });
    // financial division would be sensitive anyway; use ops + huge amount vs max_auto_approve_amount=100
    expect(r.outcome).toBe('blocked');
    expect(r.gates.bounds.within).toBe(false);
  });

  it('unregistered action type -> blocked', async () => {
    const d = makeDeps();
    const r = await adviseProposal({
      ...GOOD,
      proposal: { type: 'drop_database', division: 'ops', payload: {} },
      ...d,
    });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.bounds.pass).toBe(false);
  });

  it('low-confidence advisor -> blocked', async () => {
    const d = makeDeps({ callModel: async () => JSON.stringify({ verdict: 'AUTO-APPROVE', confidence: 0.4, reason: 'unsure' }) });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.verdict).not.toBe('AUTO-APPROVE');
  });

  it('advisor BLOCK verdict -> blocked', async () => {
    const d = makeDeps({ callModel: async () => JSON.stringify({ verdict: 'BLOCK', confidence: 0.99, reason: 'dangerous' }) });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.verdict).toBe('BLOCK');
  });

  it('advisor REVIEW verdict -> blocked', async () => {
    const d = makeDeps({ callModel: async () => JSON.stringify({ verdict: 'REVIEW', confidence: 0.7, reason: 'needs human' }) });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.verdict).toBe('REVIEW');
  });

  it('advisor timeout -> blocked, never approved', async () => {
    const d = makeDeps({
      callModel: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
    });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.advisor.status).toBe('timeout');
    expect(r.verdict).toBe('REVIEW');
  });

  it('advisor malformed output -> blocked', async () => {
    const d = makeDeps({ callModel: async () => 'I think this is probably fine honestly' });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.advisor.status).toBe('malformed');
  });

  it('advisor transport error -> blocked', async () => {
    const d = makeDeps({ callModel: async () => { throw new Error('ollama HTTP 500'); } });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.advisor.status).toBe('error');
  });

  it('missing bounds row -> blocked, advisor not consulted', async () => {
    let modelCalls = 0;
    const d = makeDeps({ callModel: async () => { modelCalls += 1; return '{}'; }, bounds: null });
    const r = await adviseProposal({ proposal: GOOD.proposal, bounds: null, execEnabled: 'true', ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.bounds.pass).toBe(false);
    expect(r.gates.advisor.status).toBe('skipped');
    expect(modelCalls).toBe(0);
  });

  it('bounds row without threshold -> blocked', async () => {
    const d = makeDeps();
    const r = await adviseProposal({ ...GOOD, bounds: { unattended_enabled: false }, ...d });
    expect(r.outcome).toBe('blocked');
  });

  it('evidence write failure -> blocked fail-closed', async () => {
    const d = makeDeps({ recordEvent: async () => { throw new Error('db down'); } });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.advisor.status).toBe('skipped');
  });

  it('decision evidence write failure does not change verdict', async () => {
    let n = 0;
    const d = makeDeps({
      recordEvent: async (row) => {
        n += 1;
        if (n === 2) throw new Error('db down on second write');
        d.events.push(row);
      },
    });
    const r = await adviseProposal({ ...GOOD, ...d });
    expect(r.outcome).toBe('would have executed');
  });

  it('sensitive division -> blocked even with approving advisor', async () => {
    const d = makeDeps();
    const r = await adviseProposal({
      ...GOOD,
      proposal: { type: 'operational_decision', division: 'financial', payload: {} },
      ...d,
    });
    expect(r.outcome).toBe('blocked');
    expect(r.gates.bounds.pass).toBe(false);
  });

  it('paused -> blocked even when all gates pass', async () => {
    const d = makeDeps();
    const r = await adviseProposal({ ...GOOD, paused: true, ...d });
    expect(r.outcome).toBe('blocked');
  });

  it('denied capability in bounds -> blocked', async () => {
    const d = makeDeps();
    const r = await adviseProposal({
      ...GOOD,
      bounds: { ...BOUNDS, denied_capabilities: ['ops.world_sync'] },
      proposal: { type: 'operational_decision', division: 'ops', payload: { capabilityId: 'ops.world_sync' } },
      ...d,
    });
    expect(r.outcome).toBe('blocked');
  });

  it('proposal + decision are both recorded in heidi_events', async () => {
    const d = makeDeps();
    await adviseProposal({ ...GOOD, ...d });
    const types = d.events.map((e) => e.payload && e.payload.event);
    expect(types).toEqual(['proposed', 'decided']);
    expect(d.events[0].event_type).toBe('action_proposal');
    expect(d.events[1].event_type).toBe('action_gate_decision');
    expect(d.events[1].payload.gates.env).toBeDefined();
    expect(d.events[1].payload.gates.advisor).toBeDefined();
    expect(d.events[1].payload.gates.bounds).toBeDefined();
  });

  it('gate log file is appended and readable', async () => {
    const d = makeDeps();
    await adviseProposal({ ...GOOD, ...d });
    const raw = JSON.parse(fs.readFileSync(d.gateLogPath, 'utf8'));
    expect(raw.entries).toHaveLength(1);
    expect(raw.entries[0].outcome).toBe('would have executed');
  });
});

describe('evaluateBoundsGate', () => {
  it('financial_approval within amount limit passes bounds checks except sensitive division', () => {
    const r = evaluateBoundsGate({
      proposal: { type: 'financial_approval', division: 'ops', payload: { amount: 50 } },
      bounds: BOUNDS,
    });
    expect(r.checks.find((c) => c.check === 'registry_bounds').pass).toBe(true);
    expect(r.checks.find((c) => c.check === 'high_risk').pass).toBe(false);
  });
});
