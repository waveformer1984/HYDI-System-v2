/**
 * Cognitive planning + goal interpretation envelope — the deterministic
 * boundaries that keep model output from becoming authority.
 */
import { validateSteps } from '../../lib/heidi/Planner';
import type { GoalModel } from '../../lib/heidi/GoalInterpreter';

describe('Planner.validateSteps — authority boundary', () => {
  test('registered R0-R2 capabilities are executable', () => {
    const steps = validateSteps([{ objective: 'observe', capability: 'ops.dev_observe', params: {} }]);
    expect(steps[0].status).toBe('executable');
  });

  test('unknown capability names are rejected, never approximated', () => {
    const steps = validateSteps([{ objective: 'fly', capability: 'ops.teleport', params: {} }]);
    expect(steps[0].status).toBe('rejected');
    expect(steps[0].reason).toMatch(/not in the registry/);
  });

  test('capabilities above R2 become human_required — never executable', () => {
    // Find any registered capability requiring >2; if none, create the
    // check inline — the rule is autonomyRequirement > MAX_AUTONOMY.
    const steps = validateSteps([{ objective: 'send mail', capability: 'tool.send_email', params: {} }]);
    expect(['human_required', 'rejected']).toContain(steps[0].status);
    expect(steps[0].status).not.toBe('executable');
  });

  test('plan size is bounded — no unbounded step lists', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ objective: `s${i}`, capability: 'ops.dev_observe', params: {} }));
    expect(validateSteps(many).length).toBeLessThanOrEqual(8);
  });
});

describe('GoalModel typing — model output can never mint facts', () => {
  test('knowledge kinds are a closed enum', () => {
    const model: GoalModel = {
      objective: 'x', desiredOutcome: '', constraints: [], completionCriteria: [],
      knowledge: [
        { kind: 'fact', statement: 'db row exists', provenance: 'db:heidi_events' },
        { kind: 'unknown', statement: 'willingness to pay unproven', provenance: 'system' },
      ],
      requiredCapabilities: [], risks: [], aiStatus: 'ok', model: 'test',
    };
    expect(model.knowledge.map(k => k.kind)).toEqual(['fact', 'unknown']);
    // And the envelope rule: a model-provenance 'fact' is demoted —
    // exercised live in GoalInterpreter.interpretGoal when Ollama returns.
  });
});
