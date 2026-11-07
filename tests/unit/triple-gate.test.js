'use strict';

const {
  evaluateTripleGate,
  safeEvaluateTripleGate,
  VERDICTS,
} = require('../../lib/governance/tripleGate');
const { isRegisteredAction, registeredActionTypes, ACTION_REGISTRY } = require('../../lib/governance/action-registry');

const BOUNDS = { auto_approve_threshold: 0.85, max_auto_approve_amount: 100 };
const GOOD_TASK = { type: 'operational_decision', division: 'ops', confidence: 0.95, within_bounds: true };
const BASE = { execEnabled: 'true', bounds: BOUNDS, task: GOOD_TASK, knownActions: registeredActionTypes() };

describe('tripleGate — every gate combination', () => {
  it('AUTO-APPROVE only when all gates pass', () => {
    const r = evaluateTripleGate(BASE);
    expect(r.verdict).toBe(VERDICTS.AUTO_APPROVE);
    expect(r.gate).toBe('confidence_bounds');
  });

  it('exec flag off -> REVIEW(exec_flag), even for a perfect task', () => {
    for (const v of [undefined, false, 'false', '0', 0, '']) {
      const r = evaluateTripleGate({ ...BASE, execEnabled: v });
      expect(r.verdict).toBe(VERDICTS.REVIEW);
      expect(r.gate).toBe('exec_flag');
    }
  });

  it('missing bounds -> REVIEW(bounds) — deny on missing data', () => {
    for (const b of [null, undefined, {}, 'x']) {
      const r = evaluateTripleGate({ ...BASE, bounds: b && typeof b === 'object' ? b : null });
      expect(r.verdict).toBe(VERDICTS.REVIEW);
      expect(r.gate).toBe('bounds');
    }
  });

  it('unregistered action type -> BLOCK(action_registry)', () => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, type: 'drop_database' } });
    expect(r.verdict).toBe(VERDICTS.BLOCK);
    expect(r.gate).toBe('action_registry');
  });

  it('missing action type -> BLOCK(action_registry)', () => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, type: undefined } });
    expect(r.verdict).toBe(VERDICTS.BLOCK);
    expect(r.gate).toBe('action_registry');
  });

  it('paused -> REVIEW(pause), never AUTO-APPROVE', () => {
    const r = evaluateTripleGate({ ...BASE, paused: true });
    expect(r.verdict).toBe(VERDICTS.REVIEW);
    expect(r.gate).toBe('pause');
  });

  it.each(['financial', 'crypto', 'vendor'])('sensitive division %s -> REVIEW(sensitive_division)', (division) => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, division } });
    expect(r.verdict).toBe(VERDICTS.REVIEW);
    expect(r.gate).toBe('sensitive_division');
  });

  it('custom sensitiveDivisions honored', () => {
    const r = evaluateTripleGate({ ...BASE, sensitiveDivisions: ['hr'], task: { ...GOOD_TASK, division: 'hr' } });
    expect(r.gate).toBe('sensitive_division');
  });

  it('confidence below 0.5 floor -> BLOCK(confidence_floor)', () => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, confidence: 0.3 } });
    expect(r.verdict).toBe(VERDICTS.BLOCK);
    expect(r.gate).toBe('confidence_floor');
  });

  it('confidence between floor and threshold -> REVIEW(confidence_threshold)', () => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, confidence: 0.7 } });
    expect(r.verdict).toBe(VERDICTS.REVIEW);
    expect(r.gate).toBe('confidence_threshold');
  });

  it('high confidence but outside bounds -> REVIEW(confidence_threshold)', () => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, within_bounds: false } });
    expect(r.verdict).toBe(VERDICTS.REVIEW);
    expect(r.verdict).not.toBe(VERDICTS.AUTO_APPROVE);
  });

  it('non-numeric confidence is treated as 0 -> BLOCK', () => {
    const r = evaluateTripleGate({ ...BASE, task: { ...GOOD_TASK, confidence: 'high' } });
    expect(r.verdict).toBe(VERDICTS.BLOCK);
  });

  it('gate order: exec flag beats everything', () => {
    const r = evaluateTripleGate({ ...BASE, execEnabled: false, paused: true, task: { type: 'nope' } });
    expect(r.gate).toBe('exec_flag');
  });

  it('gate order: unregistered action beats pause', () => {
    const r = evaluateTripleGate({ ...BASE, paused: true, task: { ...GOOD_TASK, type: 'rm_rf' } });
    expect(r.gate).toBe('action_registry');
  });
});

describe('safeEvaluateTripleGate — deny on error', () => {
  it('returns REVIEW(error) when evaluation throws', () => {
    const evil = { get task() { throw new Error('boom'); } };
    // Pass a task whose property access throws inside evaluateTripleGate.
    const input = { execEnabled: 'true', bounds: BOUNDS, knownActions: registeredActionTypes() };
    Object.defineProperty(input, 'task', { get() { throw new Error('boom'); } });
    const r = safeEvaluateTripleGate(input);
    expect(r.verdict).toBe(VERDICTS.REVIEW);
    expect(r.gate).toBe('error');
    expect(evil).toBeDefined();
  });

  it('never returns AUTO-APPROVE from the safe wrapper on garbage input', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}]) {
      const r = safeEvaluateTripleGate(bad);
      expect(r.verdict).not.toBe(VERDICTS.AUTO_APPROVE);
    }
  });
});

describe('action registry', () => {
  it('registers the known agent task types', () => {
    expect(isRegisteredAction('financial_approval')).toBe(true);
    expect(isRegisteredAction('operational_decision')).toBe(true);
    expect(isRegisteredAction('shell_exec')).toBe(false);
    expect(isRegisteredAction(undefined)).toBe(false);
  });

  it('every entry has type, risk, boundsKey, description', () => {
    for (const [k, v] of Object.entries(ACTION_REGISTRY)) {
      expect(v.type).toBe(k);
      expect(['low', 'medium', 'high']).toContain(v.risk);
      expect(typeof v.boundsKey).toBe('string');
      expect(typeof v.description).toBe('string');
    }
  });
});
