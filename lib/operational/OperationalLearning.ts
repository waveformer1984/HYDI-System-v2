/**
 * HEIDI Bounded Operational Learning Layer
 *
 * Phase 7 — HEIDI can derive operational knowledge from past events:
 *   - repeated failure patterns
 *   - recovery success rates
 *   - average recovery duration
 *   - recurring dependency failures
 *   - false-positive health detections
 *   - recovery strategies that frequently fail
 *   - escalation frequency
 *
 * HEIDI may RECOMMEND policy/strategy improvements.
 * HEIDI must NOT autonomously rewrite its own authority or production code.
 *
 * The distinction is:
 *   observe → learn → recommend
 * NOT:
 *   observe → rewrite itself → deploy itself
 *
 * This layer reads from the existing OperationalMemory and
 * PolicyDecisionRecordStore — it does NOT create a new data source.
 */

import fs from 'fs';
import path from 'path';

export interface OperationalInsights {
  timestamp: string;
  totalRecoveryAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  recoverySuccessRate: number;
  averageRecoveryDurationMs: number;
  totalEscalations: number;
  componentFailureCounts: Array<{ component: string; count: number }>;
  frequentlyFailingComponents: string[];
  averageAttemptsPerRecovery: number;
  recommendations: OperationalRecommendation[];
}

export interface OperationalRecommendation {
  type: 'policy' | 'strategy' | 'threshold' | 'observation';
  priority: 'low' | 'medium' | 'high';
  description: string;
  rationale: string;
  // HEIDI may only RECOMMEND — never auto-apply
  autoApply: false;
}

export class OperationalLearning {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Analyze operational events and PDR records to produce insights.
   * This is read-only — it never modifies operational data.
   */
  analyze(): OperationalInsights {
    const events = this.loadOperationalEvents();
    const pdrs = this.loadPDRs();

    // Recovery metrics
    const recoveryEvents = events.filter((e: any) =>
      e.type === 'recovery_completed' || e.type === 'recovery_failed',
    );
    const successfulRecoveries = events.filter(
      (e: any) => e.type === 'recovery_completed' && e.actionResult === 'success',
    ).length;
    const failedRecoveries = events.filter(
      (e: any) => e.type === 'recovery_failed',
    ).length;
    const totalRecoveryAttempts = successfulRecoveries + failedRecoveries;

    // Recovery duration (from recovery_started to recovery_completed)
    const durations: number[] = [];
    const startTimes = new Map<string, number>();
    for (const event of events) {
      if (event.type === 'recovery_started' && event.correlationId) {
        startTimes.set(event.correlationId, new Date(event.timestamp).getTime());
      }
      if (event.type === 'recovery_completed' && event.correlationId) {
        const start = startTimes.get(event.correlationId);
        if (start) {
          durations.push(new Date(event.timestamp).getTime() - start);
        }
      }
    }

    // Escalation count
    const totalEscalations = events.filter(
      (e: any) => e.type === 'escalation_triggered',
    ).length;

    // Component failure frequency
    const failureCounts = new Map<string, number>();
    for (const event of events) {
      if (event.type === 'recovery_failed' || event.type === 'recovery_started') {
        const comp = event.component;
        if (comp) {
          failureCounts.set(comp, (failureCounts.get(comp) ?? 0) + 1);
        }
      }
    }

    const componentFailureCounts = [...failureCounts.entries()]
      .map(([component, count]) => ({ component, count }))
      .sort((a, b) => b.count - a.count);

    const frequentlyFailingComponents = componentFailureCounts
      .filter((c) => c.count >= 3)
      .map((c) => c.component);

    // Average attempts per recovery (from PDRs)
    const recoveryPDRs = pdrs.filter((p: any) => p.result === 'success' || p.result === 'failure');
    const attemptCounts = recoveryPDRs
      .map((p: any) => p.detail?.execution?.attempts ?? 1)
      .filter((n: number) => n > 0);
    const averageAttemptsPerRecovery = attemptCounts.length > 0
      ? attemptCounts.reduce((s: number, n: number) => s + n, 0) / attemptCounts.length
      : 0;

    // Generate recommendations (OBSERVE → LEARN → RECOMMEND, never auto-apply)
    const recommendations = this.generateRecommendations({
      totalRecoveryAttempts,
      successfulRecoveries,
      failedRecoveries,
      totalEscalations,
      frequentlyFailingComponents,
      averageAttemptsPerRecovery,
      componentFailureCounts,
    });

    return {
      timestamp: new Date().toISOString(),
      totalRecoveryAttempts,
      successfulRecoveries,
      failedRecoveries,
      recoverySuccessRate: totalRecoveryAttempts > 0
        ? successfulRecoveries / totalRecoveryAttempts
        : 0,
      averageRecoveryDurationMs: durations.length > 0
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : 0,
      totalEscalations,
      componentFailureCounts: componentFailureCounts.slice(0, 10),
      frequentlyFailingComponents,
      averageAttemptsPerRecovery: Math.round(averageAttemptsPerRecovery * 100) / 100,
      recommendations,
    };
  }

  private generateRecommendations(data: {
    totalRecoveryAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    totalEscalations: number;
    frequentlyFailingComponents: string[];
    averageAttemptsPerRecovery: number;
    componentFailureCounts: Array<{ component: string; count: number }>;
  }): OperationalRecommendation[] {
    const recs: OperationalRecommendation[] = [];

    // Low success rate → recommend policy review
    if (data.totalRecoveryAttempts >= 5) {
      const successRate = data.successfulRecoveries / data.totalRecoveryAttempts;
      if (successRate < 0.5) {
        recs.push({
          type: 'policy',
          priority: 'high',
          description: `Recovery success rate is ${(successRate * 100).toFixed(1)}% — below 50% threshold. Review recovery policies for failing components.`,
          rationale: `${data.failedRecoveries} out of ${data.totalRecoveryAttempts} recovery attempts failed.`,
          autoApply: false,
        });
      }
    }

    // Frequently failing components → recommend investigation
    if (data.frequentlyFailingComponents.length > 0) {
      recs.push({
        type: 'observation',
        priority: 'high',
        description: `Components failing frequently: ${data.frequentlyFailingComponents.join(', ')}. Investigate root cause.`,
        rationale: 'Repeated failures suggest a systemic issue, not transient faults.',
        autoApply: false,
      });
    }

    // High escalation rate → recommend policy adjustment
    if (data.totalRecoveryAttempts > 0 && data.totalEscalations / data.totalRecoveryAttempts > 0.3) {
      recs.push({
        type: 'threshold',
        priority: 'medium',
        description: `Escalation rate is ${(data.totalEscalations / data.totalRecoveryAttempts * 100).toFixed(1)}% — consider increasing recovery budget or adjusting cooldown.`,
        rationale: 'High escalation rate suggests recovery budgets may be too tight.',
        autoApply: false,
      });
    }

    // High average attempts → recommend strategy review
    if (data.averageAttemptsPerRecovery > 2) {
      recs.push({
        type: 'strategy',
        priority: 'medium',
        description: `Average recovery attempts is ${data.averageAttemptsPerRecovery} — consider reviewing recovery strategies.`,
        rationale: 'High attempt count suggests the first recovery action is often insufficient.',
        autoApply: false,
      });
    }

    return recs;
  }

  private loadOperationalEvents(): any[] {
    const filePath = path.resolve(this.root, '.hydi-operational', 'operational-events.jsonl');
    return this.loadJSONL(filePath);
  }

  private loadPDRs(): any[] {
    const filePath = path.resolve(this.root, '.hydi-operational', 'policy-decisions.jsonl');
    return this.loadJSONL(filePath);
  }

  private loadJSONL(filePath: string): any[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf8');
      return content.trim().split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter((v) => v !== null);
    } catch {
      return [];
    }
  }
}
