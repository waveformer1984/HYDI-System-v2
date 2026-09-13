/**
 * Phase 3 — Incident Correlator Tests
 *
 * Tests:
 * - Failures create incidents
 * - Downstream failures are correlated with upstream root causes
 * - Incidents are resolved when components return to HEALTHY
 * - Diagnostic output is produced
 */

import { IncidentCorrelator } from '../../lib/operational/IncidentCorrelator';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import { DependencyGraphBuilder } from '../../lib/operational/DependencyGraphBuilder';
import path from 'path';
import type { OperationalEvent } from '../../lib/operational/types';

describe('Phase 3 — IncidentCorrelator', () => {
  let model: SystemStateModel;
  let correlator: IncidentCorrelator;
  const root = path.resolve(__dirname, '..', '..');

  beforeEach(() => {
    const graphBuilder = new DependencyGraphBuilder(root);
    const graph = graphBuilder.build();
    model = new SystemStateModel();
    for (const [id, node] of graph.nodes) {
      model.registerComponent(id, node.category);
    }
    correlator = new IncidentCorrelator(model, graph);
  });

  function makeFailureEvent(component: string, cause?: string): OperationalEvent {
    return {
      id: `test-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      type: 'state_transition',
      component,
      previousState: 'HEALTHY',
      newState: 'UNAVAILABLE',
      cause,
    };
  }

  it('creates an incident for a new failure', () => {
    const event = makeFailureEvent('database', 'connection lost');
    const incident = correlator.correlateFailure(event);
    expect(incident).not.toBeNull();
    expect(incident!.rootComponent).toBe('database');
    expect(incident!.state).toBe('active');
  });

  it('correlates downstream failures with upstream root cause', () => {
    // Database fails first
    const dbEvent = makeFailureEvent('database', 'connection lost');
    correlator.correlateFailure(dbEvent);

    // ProtoForge fails because database is down
    const pfEvent = makeFailureEvent('protoforge-core', 'database unavailable');
    const incident = correlator.correlateFailure(pfEvent);

    // Should be correlated with the database incident
    expect(incident).not.toBeNull();
    expect(incident!.rootComponent).toBe('database');
    expect(incident!.affectedComponents).toContain('protoforge-core');
  });

  it('does not create duplicate incidents for the same component', () => {
    const event1 = makeFailureEvent('database', 'connection lost');
    const incident1 = correlator.correlateFailure(event1);

    const event2 = makeFailureEvent('database', 'still down');
    const incident2 = correlator.correlateFailure(event2);

    expect(incident1!.id).toBe(incident2!.id);
    expect(incident2!.events).toHaveLength(2);
  });

  it('resolves incidents when component recovers', () => {
    const event = makeFailureEvent('database', 'connection lost');
    correlator.correlateFailure(event);

    const resolved = correlator.resolveIncident('database', 'recovered');
    expect(resolved).not.toBeNull();
    expect(resolved!.state).toBe('resolved');
    expect(resolved!.endTime).toBeDefined();
  });

  it('produces diagnostic output for an incident', () => {
    const event = makeFailureEvent('database', 'connection lost');
    const incident = correlator.correlateFailure(event)!;

    const diag = correlator.produceDiagnostic(incident.id);
    expect(diag).not.toBeNull();
    expect(diag!).toContain('INCIDENT');
    expect(diag!).toContain('database');
    expect(diag!).toContain('connection lost');
  });

  it('ignores non-failure events', () => {
    const event: OperationalEvent = {
      id: 'test',
      timestamp: new Date().toISOString(),
      type: 'probe_executed',
      component: 'database',
    };
    const incident = correlator.correlateFailure(event);
    expect(incident).toBeNull();
  });

  it('tracks active and resolved incidents', () => {
    const event = makeFailureEvent('database', 'connection lost');
    correlator.correlateFailure(event);

    expect(correlator.getActiveIncidents()).toHaveLength(1);

    correlator.resolveIncident('database', 'recovered');

    expect(correlator.getActiveIncidents()).toHaveLength(0);
    expect(correlator.getResolvedIncidents()).toHaveLength(1);
  });
});
