// FORENSIC AUDIT SYSTEM - Complete traceability and verification

import { TaskEvent } from './event-sourced-ledger.js';
import { TaskState } from './task-state-projection.js';
import { createHash } from 'crypto';

export interface AuditReport {
  audit_id: string;
  timestamp: string;
  event_count: number;
  task_count: number;
  integrity_violations: Violation[];
  anomalies: Anomaly[];
  timeline_gaps: TimelineGap[];
  state_inconsistencies: StateInconsistency[];
  overall_status: 'pass' | 'fail' | 'warning';
  audit_hash: string;
}

export interface Violation {
  type: 'sequence_gap' | 'checksum_mismatch' | 'invalid_event' | 'tampering';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  sequence_number?: number;
  event_id?: string;
  evidence: any;
}

export interface Anomaly {
  type: 'duplicate_event' | 'future_timestamp' | 'impossible_transition' | 'orphaned_state';
  severity: 'medium' | 'low';
  description: string;
  details: any;
}

export interface TimelineGap {
  start_sequence: number;
  end_sequence: number;
  size: number;
  estimated_missing_events: number;
}

export interface StateInconsistency {
  task_id: string;
  expected_state: any;
  actual_state: any;
  divergence_point: number;
}

export class ForensicAuditor {
  private readonly auditLog: string;

  constructor(basePath: string = './data') {
    this.auditLog = `${basePath}/audit.log`;
  }

  /**
   * Perform complete forensic audit of event stream
   */
  async performAudit(events: TaskEvent[], projectedState: Map<string, TaskState>): Promise<AuditReport> {
    const auditId = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    const violations: Violation[] = [];
    const anomalies: Anomaly[] = [];
    const timelineGaps: TimelineGap[] = [];
    const stateInconsistencies: StateInconsistency[] = [];

    // 1. Basic integrity checks
    await this.checkEventIntegrity(events, violations);

    // 2. Timeline continuity
    await this.checkTimelineContinuity(events, timelineGaps);

    // 3. Event validation
    await this.validateEventStructure(events, violations, anomalies);

    // 4. State reconstruction verification
    await this.verifyStateConsistency(events, projectedState, stateInconsistencies);

    // 5. Check for tampering
    await this.detectTampering(events, violations);

    // Calculate overall status
    const overallStatus = this.calculateOverallStatus(violations, anomalies);

    // Create audit hash
    const auditHash = this.calculateAuditHash({
      auditId,
      events,
      violations,
      anomalies,
      timelineGaps,
      stateInconsistencies
    });

    const report: AuditReport = {
      audit_id: auditId,
      timestamp,
      event_count: events.length,
      task_count: projectedState.size,
      integrity_violations: violations,
      anomalies: anomalies,
      timeline_gaps: timelineGaps,
      state_inconsistencies: stateInconsistencies,
      overall_status: overallStatus,
      audit_hash: auditHash
    };

    // Persist audit report
    await this.persistAuditReport(report);

    return report;
  }

  /**
   * Check basic event integrity
   */
  private async checkEventIntegrity(events: TaskEvent[], violations: Violation[]): Promise<void> {
    // Check for empty events
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (!event.event_id || !event.event_type || !event.task_id) {
        violations.push({
          type: 'invalid_event',
          severity: 'critical',
          description: `Event missing required fields at index ${i}`,
          sequence_number: event.sequence_number,
          event_id: event.event_id,
          evidence: event
        });
      }
    }

    // Check for duplicate event IDs
    const eventIds = new Set<string>();
    for (const event of events) {
      if (eventIds.has(event.event_id)) {
        violations.push({
          type: 'invalid_event',
          severity: 'high',
          description: `Duplicate event ID detected: ${event.event_id}`,
          event_id: event.event_id,
          sequence_number: event.sequence_number,
          evidence: event
        });
      }
      eventIds.add(event.event_id);
    }
  }

  /**
   * Check timeline continuity
   */
  private async checkTimelineContinuity(events: TaskEvent[], gaps: TimelineGap[]): Promise<void> {
    if (events.length === 0) return;

    // Sort by sequence number
    const sortedEvents = [...events].sort((a, b) => a.sequence_number - b.sequence_number);

    for (let i = 1; i < sortedEvents.length; i++) {
      const prev = sortedEvents[i - 1];
      const curr = sortedEvents[i];

      const expectedSequence = prev.sequence_number + 1;
      if (curr.sequence_number !== expectedSequence) {
        gaps.push({
          start_sequence: prev.sequence_number,
          end_sequence: curr.sequence_number,
          size: curr.sequence_number - prev.sequence_number - 1,
          estimated_missing_events: curr.sequence_number - prev.sequence_number - 1
        });
      }
    }
  }

  /**
   * Validate event structure and content
   */
  private async validateEventStructure(
    events: TaskEvent[],
    violations: Violation[],
    anomalies: Anomaly[]
  ): Promise<void> {
    const now = new Date();

    for (const event of events) {
      // Check for future timestamps
      const eventTime = new Date(event.timestamp);
      if (eventTime > now) {
        anomalies.push({
          type: 'future_timestamp',
          severity: 'medium',
          description: `Event timestamp is in the future: ${event.timestamp}`,
          details: {
            event_id: event.event_id,
            timestamp: event.timestamp,
            current_time: now.toISOString()
          }
        });
      }

      // Validate event-specific structure
      switch (event.event_type) {
        case 'task_created':
          if (!event.data?.title) {
            violations.push({
              type: 'invalid_event',
              severity: 'high',
              description: 'Task creation event missing title',
              event_id: event.event_id,
              sequence_number: event.sequence_number,
              evidence: event
            });
          }
          break;

        case 'task_updated':
          if (!event.data?.state_version) {
            violations.push({
              type: 'invalid_event',
              severity: 'high',
              description: 'Task update event missing state version',
              event_id: event.event_id,
              sequence_number: event.sequence_number,
              evidence: event
            });
          }
          break;
      }
    }
  }

  /**
   * Verify state consistency by replaying events
   */
  private async verifyStateConsistency(
    events: TaskEvent[],
    projectedState: Map<string, TaskState>,
    inconsistencies: StateInconsistency[]
  ): Promise<void> {
    // Replay events to get expected state
    const { PureTaskStateReducer } = await import('./pure-state-reducer.js');
    const expectedState = new Map<string, TaskState>();

    for (const event of events) {
      const current = expectedState.get(event.task_id) || null;
      const result = PureTaskStateReducer.reduce(current, event);
      expectedState.set(event.task_id, result.newState);
    }

    // Compare with projected state
    for (const [taskId, actualState] of projectedState.entries()) {
      const expected = expectedState.get(taskId);

      if (!expected) {
        inconsistencies.push({
          task_id: taskId,
          expected_state: null,
          actual_state: actualState,
          divergence_point: -1
        });
        continue;
      }

      // Compare critical fields
      if (expected.state_version !== actualState.state_version ||
        expected.status !== actualState.status) {
        inconsistencies.push({
          task_id: taskId,
          expected_state: expected,
          actual_state: actualState,
          divergence_point: expected.state_version
        });
      }
    }
  }

  /**
   * Detect potential tampering
   */
  private async detectTampering(events: TaskEvent[], violations: Violation[]): Promise<void> {
    // Check for suspicious patterns
    const eventCountsByType = new Map<string, number>();
    const eventsByTask = new Map<string, TaskEvent[]>();

    for (const event of events) {
      // Count by type
      eventCountsByType.set(event.event_type, (eventCountsByType.get(event.event_type) || 0) + 1);

      // Group by task
      if (!eventsByTask.has(event.task_id)) {
        eventsByTask.set(event.task_id, []);
      }
      eventsByTask.get(event.task_id)!.push(event);
    }

    // Look for unusual patterns
    for (const [task_id, taskEvents] of eventsByTask.entries()) {
      // Check for too many status changes
      const statusChanges = taskEvents.filter(e => e.event_type === 'task_updated' && e.data?.status).length;
      if (statusChanges > 20) {
        violations.push({
          type: 'tampering',
          severity: 'medium',
          description: `Suspicious number of status changes for task ${task_id}: ${statusChanges}`,
          evidence: { task_id, status_changes: statusChanges }
        });
      }
    }
  }

  /**
   * Calculate overall audit status
   */
  private calculateOverallStatus(
    violations: Violation[],
    anomalies: Anomaly[]
  ): 'pass' | 'fail' | 'warning' {
    const criticalViolations = violations.filter(v => v.severity === 'critical').length;
    const highViolations = violations.filter(v => v.severity === 'high').length;

    if (criticalViolations > 0) {
      return 'fail';
    }

    if (highViolations > 0 || violations.length > 10) {
      return 'fail';
    }

    if (violations.length > 0 || anomalies.length > 0) {
      return 'warning';
    }

    return 'pass';
  }

  /**
   * Calculate audit hash for verification
   */
  private calculateAuditHash(data: any): string {
    const canonical = JSON.stringify(data, Object.keys(data).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Persist audit report
   */
  private async persistAuditReport(report: AuditReport): Promise<void> {
    const fs = await import('fs/promises');
    const reportLine = JSON.stringify(report) + '\n';
    await fs.appendFile(this.auditLog, reportLine);
  }

  /**
   * Load audit reports
   */
  async loadAuditReports(limit: number = 100): Promise<AuditReport[]> {
    const fs = await import('fs/promises');

    try {
      const data = await fs.readFile(this.auditLog, 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);

      const reports = lines.slice(-limit).map(line => {
        try {
          return JSON.parse(line) as AuditReport;
        } catch {
          return null;
        }
      }).filter(r => r !== null) as AuditReport[];

      return reports;
    } catch {
      return [];
    }
  }

  /**
   * Verify audit chain integrity
   */
  async verifyAuditChain(): Promise<{
    valid: boolean;
    brokenLinks: number;
    lastValidAudit: string | null;
  }> {
    const reports = await this.loadAuditReports(1000);

    if (reports.length === 0) {
      return { valid: true, brokenLinks: 0, lastValidAudit: null };
    }

    let brokenLinks = 0;
    let lastValidAudit: string | null = null;

    // Each audit should verify the previous one
    for (let i = 1; i < reports.length; i++) {
      const current = reports[i];
      const previous = reports[i - 1];

      // In a real implementation, we'd verify cryptographic signatures
      // For now, just check basic continuity
      if (new Date(current.timestamp) <= new Date(previous.timestamp)) {
        brokenLinks++;
      } else {
        lastValidAudit = current.audit_id;
      }
    }

    return {
      valid: brokenLinks === 0,
      brokenLinks,
      lastValidAudit
    };
  }
}
