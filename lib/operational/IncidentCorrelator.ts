/**
 * HYDI Incident Correlator
 *
 * Multiple symptoms may represent one root failure. This module correlates
 * operational events into incidents so HYDI can identify:
 *
 *   ROOT CAUSE: Postgres unavailable
 *   DEPENDENT IMPACT: ProtoForge, Heidi
 *
 * Instead of creating three unrelated incidents.
 *
 * Correlation is based on:
 * - Dependency graph (if A depends on B and both fail, B is likely root cause)
 * - Time window (events within a short window are likely correlated)
 * - Causal chain (recovery of B should resolve A's failure too)
 */

import { randomUUID } from 'crypto';
import type {
  OperationalEvent,
  ComponentState,
  ComponentHealth,
} from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { DependencyGraph } from './types';

export interface Incident {
  id: string;
  rootCause: string;
  rootComponent: string;
  affectedComponents: string[];
  startTime: string;
  endTime?: string;
  events: OperationalEvent[];
  state: 'active' | 'resolved' | 'escalated';
  resolution?: string;
  // Phase 4 enhanced fields (optional for backward compatibility)
  correlationId?: string;
  timeline?: Array<{ timestamp: string; event: string; component: string }>;
  probableCause?: string;
  confidence?: number;
  actions?: Array<{ action: string; result: string; timestamp: string }>;
  finalState?: ComponentState;
}

export class IncidentCorrelator {
  private stateModel: SystemStateModel;
  private graph: DependencyGraph;
  private activeIncidents = new Map<string, Incident>(); // rootComponent -> Incident
  private resolvedIncidents: Incident[] = [];
  private correlationWindowMs = 60000; // 60s window for correlation

  constructor(stateModel: SystemStateModel, graph: DependencyGraph) {
    this.stateModel = stateModel;
    this.graph = graph;
  }

  /**
   * Correlate a new failure event with existing incidents.
   * If the failure is caused by an upstream dependency that already has
   * an active incident, the new failure is added to that incident.
   * Otherwise, a new incident is created.
   */
  correlateFailure(event: OperationalEvent): Incident | null {
    if (event.type !== 'failure_detected' && event.type !== 'state_transition') {
      return null;
    }
    if (event.newState !== 'UNAVAILABLE' && event.newState !== 'FAILED' && event.newState !== 'BLOCKED') {
      return null;
    }

    const component = event.component;

    // Check if this failure is caused by an upstream dependency that already has an incident
    const node = this.graph.nodes.get(component);
    if (node) {
      for (const dep of node.dependencies) {
        const existingIncident = this.activeIncidents.get(dep);
        if (existingIncident) {
          // This failure is a downstream symptom of an existing incident
          existingIncident.events.push(event);
          if (!existingIncident.affectedComponents.includes(component)) {
            existingIncident.affectedComponents.push(component);
          }
          return existingIncident;
        }
      }
    }

    // Check if there's already an incident for this component
    const existing = this.activeIncidents.get(component);
    if (existing) {
      existing.events.push(event);
      return existing;
    }

    // Create new incident
    const incident: Incident = {
      id: randomUUID(),
      rootCause: event.cause || `component ${component} failed`,
      rootComponent: component,
      affectedComponents: [component],
      startTime: event.timestamp,
      events: [event],
      state: 'active',
      // Phase 4 enhanced fields
      correlationId: randomUUID(),
      timeline: [{
        timestamp: event.timestamp,
        event: event.type,
        component,
      }],
      probableCause: event.cause || `component ${component} failed`,
      confidence: 50,
      actions: [],
      finalState: event.newState,
    };

    this.activeIncidents.set(component, incident);
    return incident;
  }

  /**
   * Mark an incident as resolved when the root component returns to HEALTHY.
   */
  resolveIncident(component: string, resolution: string): Incident | null {
    const incident = this.activeIncidents.get(component);
    if (!incident) return null;

    incident.state = 'resolved';
    incident.endTime = new Date().toISOString();
    incident.resolution = resolution;
    this.activeIncidents.delete(component);
    this.resolvedIncidents.push(incident);
    return incident;
  }

  /**
   * Get all active incidents.
   */
  getActiveIncidents(): Incident[] {
    return Array.from(this.activeIncidents.values());
  }

  /**
   * Get recently resolved incidents.
   */
  getResolvedIncidents(limit = 20): Incident[] {
    return this.resolvedIncidents.slice(-limit);
  }

  /**
   * Get the incident for a specific component (active or resolved).
   */
  getIncidentForComponent(component: string): Incident | null {
    return this.activeIncidents.get(component) ?? null;
  }

  /**
   * Get all incidents (active + resolved).
   */
  getAllIncidents(): Incident[] {
    return [...this.activeIncidents.values(), ...this.resolvedIncidents];
  }

  /**
   * Phase 4: Escalate an incident (mark as escalated, not resolved).
   */
  escalateIncident(component: string, reason: string): Incident | null {
    const incident = this.activeIncidents.get(component);
    if (!incident) return null;

    incident.state = 'escalated';
    incident.endTime = new Date().toISOString();
    incident.resolution = `ESCALATED: ${reason}`;
    this.activeIncidents.delete(component);
    this.resolvedIncidents.push(incident);
    return incident;
  }

  /**
   * Phase 4: Record an action taken on an incident.
   */
  recordAction(component: string, action: string, result: string): void {
    const incident = this.activeIncidents.get(component);
    if (!incident) return;

    if (!incident.actions) incident.actions = [];
    incident.actions.push({
      action,
      result,
      timestamp: new Date().toISOString(),
    });

    if (!incident.timeline) incident.timeline = [];
    incident.timeline.push({
      timestamp: new Date().toISOString(),
      event: `action: ${action}`,
      component,
    });
  }

  /**
   * Phase 4: Get the correlation ID for a component's active incident.
   */
  getCorrelationId(component: string): string | null {
    const incident = this.activeIncidents.get(component);
    return incident?.correlationId ?? null;
  }

  /**
   * Produce a diagnostic summary for an incident.
   */
  produceDiagnostic(incidentId: string): string | null {
    const incident = this.getAllIncidents().find((i) => i.id === incidentId);
    if (!incident) return null;

    const lines: string[] = [
      `INCIDENT ${incident.id}`,
      `root_cause: ${incident.rootCause}`,
      `root_component: ${incident.rootComponent}`,
      `affected: ${incident.affectedComponents.join(', ')}`,
      `state: ${incident.state}`,
      `start: ${incident.startTime}`,
      incident.endTime ? `end: ${incident.endTime}` : 'end: (active)',
      '',
      'events:',
    ];

    for (const event of incident.events) {
      lines.push(
        `  [${event.timestamp}] ${event.type}: ${event.component}` +
          ` ${event.previousState ?? '?'} → ${event.newState ?? '?'}` +
          (event.cause ? ` cause: ${event.cause}` : ''),
      );
    }

    if (incident.resolution) {
      lines.push('', `resolution: ${incident.resolution}`);
    }

    return lines.join('\n');
  }
}
