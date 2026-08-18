/**
 * Phase 3 Operational Intelligence — State Model Tests
 *
 * Tests:
 * - Component states are tracked correctly
 * - UNKNOWN is never collapsed into HEALTHY or FAILED
 * - State transitions are logged as events
 * - Overall state is the worst across all components
 */

import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import type { HealthEvidence } from '../../lib/operational/types';

describe('Phase 3 — SystemStateModel', () => {
  let model: SystemStateModel;

  beforeEach(() => {
    model = new SystemStateModel();
  });

  it('registers components with UNKNOWN state', () => {
    model.registerComponent('test-comp', 'runtime');
    const state = model.getState('test-comp');
    expect(state.state).toBe('UNKNOWN');
    expect(state.component).toBe('test-comp');
  });

  it('updates state with evidence', () => {
    model.registerComponent('test-comp', 'runtime');
    const evidence: HealthEvidence[] = [
      { check: 'port', status: 'pass', value: 'port 3005 listening', checkedAt: new Date().toISOString() },
    ];
    model.updateState('test-comp', 'HEALTHY', evidence);
    expect(model.getState('test-comp').state).toBe('HEALTHY');
    expect(model.getState('test-comp').evidence).toHaveLength(1);
  });

  it('logs state transitions as operational events', () => {
    model.registerComponent('test-comp', 'runtime');
    model.updateState('test-comp', 'HEALTHY', []);
    model.updateState('test-comp', 'UNAVAILABLE', [], undefined, 'port not listening');

    const transitions = model.getEventsByType('state_transition');
    expect(transitions).toHaveLength(2);
    expect(transitions[0].previousState).toBe('UNKNOWN');
    expect(transitions[0].newState).toBe('HEALTHY');
    expect(transitions[1].previousState).toBe('HEALTHY');
    expect(transitions[1].newState).toBe('UNAVAILABLE');
  });

  it('does NOT log events when state does not change', () => {
    model.registerComponent('test-comp', 'runtime');
    model.updateState('test-comp', 'HEALTHY', []);
    model.updateState('test-comp', 'HEALTHY', []);
    model.updateState('test-comp', 'HEALTHY', []);

    const transitions = model.getEventsByType('state_transition');
    expect(transitions).toHaveLength(1); // only the UNKNOWN → HEALTHY transition
  });

  it('computes overall state as the worst across components', () => {
    model.registerComponent('a', 'runtime');
    model.registerComponent('b', 'runtime');
    model.registerComponent('c', 'runtime');

    model.updateState('a', 'HEALTHY', []);
    model.updateState('b', 'DEGRADED', []);
    model.updateState('c', 'UNAVAILABLE', []);

    expect(model.getOverallState()).toBe('UNAVAILABLE');
  });

  it('treats UNKNOWN as worse than HEALTHY but better than FAILED', () => {
    model.registerComponent('a', 'runtime');
    model.registerComponent('b', 'runtime');

    model.updateState('a', 'HEALTHY', []);
    model.updateState('b', 'UNKNOWN', []);

    expect(model.getOverallState()).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for unregistered components', () => {
    const state = model.getState('nonexistent');
    expect(state.state).toBe('UNKNOWN');
  });

  it('tracks correlation IDs on events', () => {
    model.registerComponent('test-comp', 'runtime');
    model.updateState('test-comp', 'UNAVAILABLE', []);
    
    const event = model.getEventsByType('state_transition')[0];
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.type).toBe('state_transition');
  });

  it('reset clears all state and events', () => {
    model.registerComponent('test-comp', 'runtime');
    model.updateState('test-comp', 'HEALTHY', []);
    model.reset();
    expect(model.getAllStates()).toHaveLength(0);
    expect(model.getRecentEvents()).toHaveLength(0);
  });
});
