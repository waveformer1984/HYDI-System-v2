import { gateActions, isEnforcing } from '../../lib/protoforge/action-gate';

const mockGenerateHypotheses = jest.fn();
const mockCreateKiloEngine = jest.fn((_opts?: Record<string, unknown>) => ({ generateHypotheses: mockGenerateHypotheses }));
const mockAutoGate = jest.fn();

jest.mock('../../kilo/index.js', () => ({
  createKiloEngine: (opts?: Record<string, unknown>) => mockCreateKiloEngine(opts),
}));

jest.mock('../../lib/protoforge/auto-gate.js', () => ({
  autoGate: (hypotheses: unknown[], stream: string | null) => mockAutoGate(hypotheses, stream),
}));

describe('action-gate — isEnforcing', () => {
  const original = process.env.PROTOFORGE_ENFORCE_ACTIONS;
  afterEach(() => {
    if (original === undefined) delete process.env.PROTOFORGE_ENFORCE_ACTIONS;
    else process.env.PROTOFORGE_ENFORCE_ACTIONS = original;
  });

  test('defaults to false (observe-only) when unset', () => {
    delete process.env.PROTOFORGE_ENFORCE_ACTIONS;
    expect(isEnforcing()).toBe(false);
  });

  test('is true only for the exact string "true"', () => {
    process.env.PROTOFORGE_ENFORCE_ACTIONS = 'true';
    expect(isEnforcing()).toBe(true);
    process.env.PROTOFORGE_ENFORCE_ACTIONS = 'yes';
    expect(isEnforcing()).toBe(false);
  });
});

describe('action-gate — gateActions', () => {
  beforeEach(() => {
    mockGenerateHypotheses.mockReset();
    mockCreateKiloEngine.mockClear();
    mockAutoGate.mockReset();
  });

  test('empty actions array short-circuits without calling KILO or ProtoForge', async () => {
    const result = await gateActions([], 'session-1');
    expect(result).toEqual([]);
    expect(mockCreateKiloEngine).not.toHaveBeenCalled();
  });

  test('builds one KILO hypothesis per action and maps decisions back correctly', async () => {
    mockGenerateHypotheses.mockImplementation((payload: any) => ({
      hypotheses: [`hyp-for-${payload.classification}`],
      confidence: 0.5,
      gate_result: { verified: false },
    }));
    mockAutoGate.mockImplementation(async (hypotheses: any[]) => ({
      decisions: hypotheses.map((h) => ({ hypothesisId: h.id, decision: 'approve', reasoning: 'test reasoning' })),
    }));

    const actions = [
      { type: 'create_task', payload: { title: 'a' } },
      { type: 'send_email', payload: { to: 'x@example.com' } },
    ];
    const verdicts = await gateActions(actions, 'session-1');

    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].action).toBe(actions[0]);
    expect(verdicts[0].decision).toBe('approve');
    expect(verdicts[0].confidence).toBe(0.5);
    expect(verdicts[0].hypotheses).toEqual(['hyp-for-create_task']);
    expect(verdicts[1].hypotheses).toEqual(['hyp-for-send_email']);
    expect(mockGenerateHypotheses).toHaveBeenCalledTimes(2);
  });

  test('unverified gate result produces risk=1 fed into the ProtoForge hypothesis', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0, gate_result: { verified: false } });
    mockAutoGate.mockResolvedValue({ decisions: [] });

    await gateActions([{ type: 'fetch_data', payload: {} }], 'session-2');

    const hypothesesArg = mockAutoGate.mock.calls[0][0];
    expect(hypothesesArg[0].risk).toBe(1);
    expect(hypothesesArg[0].confidence).toBe(0);
    expect(hypothesesArg[0].revenue_impact).toBe(0);
  });

  test('tags each hypothesis with the action_type it came from, so DSL rules can differentiate by action', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0, gate_result: { verified: false } });
    mockAutoGate.mockResolvedValue({ decisions: [] });

    const actions = [
      { type: 'fetch_data', payload: {} },
      { type: 'send_email', payload: { to: 'x@example.com' } },
    ];
    await gateActions(actions, 'session-action-type');

    const hypothesesArg = mockAutoGate.mock.calls[0][0];
    expect(hypothesesArg.map((h: any) => h.action_type)).toEqual(['fetch_data', 'send_email']);
  });

  test('verified gate result lowers risk with confidence', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0.9, gate_result: { verified: true } });
    mockAutoGate.mockResolvedValue({ decisions: [] });

    await gateActions([{ type: 'create_task', payload: {} }], 'session-2b');

    const hypothesesArg = mockAutoGate.mock.calls[0][0];
    expect(hypothesesArg[0].risk).toBeCloseTo(0.1);
  });

  test('degrades to skipped verdicts when ProtoForge gating throws, never throws itself', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0, gate_result: { verified: false } });
    mockAutoGate.mockRejectedValue(new Error('policy engine unavailable'));

    const actions = [{ type: 'create_task', payload: {} }];
    const verdicts = await gateActions(actions, 'session-3');

    expect(verdicts).toEqual([{ action: actions[0], decision: 'skipped', confidence: 0, hypotheses: [] }]);
  });

  test('a hypothesis with no matching decision falls back to skipped', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: ['h'], confidence: 0.9, gate_result: { verified: true } });
    mockAutoGate.mockResolvedValue({ decisions: [] });

    const verdicts = await gateActions([{ type: 'create_task', payload: {} }], 'session-4');
    expect(verdicts[0].decision).toBe('skipped');
  });

  test('tags each hypothesis with its plan_step / plan_total_steps position', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0.5, gate_result: { verified: false } });
    mockAutoGate.mockResolvedValue({ decisions: [] });

    const actions = [
      { type: 'create_task', payload: {} },
      { type: 'send_email', payload: {} },
      { type: 'schedule_event', payload: {} },
    ];
    await gateActions(actions, 'session-5');

    const hypothesesArg = mockAutoGate.mock.calls[0][0];
    expect(hypothesesArg.map((h: any) => h.plan_step)).toEqual([1, 2, 3]);
    expect(hypothesesArg.every((h: any) => h.plan_total_steps === 3)).toBe(true);
  });

  test('propagates the ProtoForge decisionId onto the verdict', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0.9, gate_result: { verified: true } });
    mockAutoGate.mockImplementation(async (hypotheses: any[]) => ({
      decisions: hypotheses.map((h) => ({ hypothesisId: h.id, decision: 'approve', decisionId: `decision-${h.id}` })),
    }));

    const verdicts = await gateActions([{ type: 'create_task', payload: {} }], 'session-6');
    const hypothesesArg = mockAutoGate.mock.calls[0][0];
    expect(verdicts[0].decisionId).toBe(`decision-${hypothesesArg[0].id}`);
  });

  test('decisionId is undefined when the decision is skipped', async () => {
    mockGenerateHypotheses.mockReturnValue({ hypotheses: [], confidence: 0, gate_result: { verified: false } });
    mockAutoGate.mockRejectedValue(new Error('unavailable'));

    const verdicts = await gateActions([{ type: 'create_task', payload: {} }], 'session-7');
    expect(verdicts[0].decisionId).toBeUndefined();
  });
});
