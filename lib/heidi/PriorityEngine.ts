/**
 * HEIDI Priority Engine — HYDI 4, Phase B
 *
 * Deterministic prioritization: reduce a broad observed condition set to
 * a bounded, ranked list of worthwhile next actions. NOT an LLM opinion —
 * every score is computed from declared, inspectable inputs, and the
 * breakdown is carried on the result so a human can audit WHY an action
 * outranked another.
 *
 * Score:
 *   priority = impact × confidence × urgency × autonomyFit ÷ effort
 *
 * Governance overrides score: a prohibited action stays prohibited
 * regardless of its score — it lands in `refused`, never `ranked`.
 * Human-required work is likewise never ranked as an autonomous action;
 * it is surfaced as `deferred` (needs a human) rather than silently
 * skipped.
 */

export interface ConditionAssessment {
  /** Blast radius of the condition — 0..10. */
  impact: number;
  /** How time-sensitive — 0..10 (10 = decaying fast). */
  urgency: number;
  /** Confidence the condition is real — 0..1. */
  confidence: number;
  /** 1 = fully reversible action, 0 = irreversible. */
  reversibility: number;
  /** Autonomy level the action requires — 0..5. */
  autonomyLevel: number;
  /** Estimated effort — 1..10 (higher = more work). */
  estimatedEffort: number;
  /** Health of dependencies the action needs — 0..1. */
  dependencyHealth: number;
  /** Expected revenue effect — -10..10. */
  revenueEffect: number;
  /** True when a human must act — the engine surfaces it, never scores it as autonomous. */
  humanRequired: boolean;
  /** Governance override — prohibited stays prohibited regardless of score. */
  prohibited?: boolean;
  prohibitionReason?: string;
}

export interface PriorityItem<T> {
  item: T;
  /** 0 when refused/deferred. */
  score: number;
  refused: boolean;
  deferred: boolean;
  reason?: string;
  /** Inspectable factor breakdown for audit. */
  breakdown: {
    impact: number;
    urgency: number;
    confidence: number;
    autonomyFit: number;
    effort: number;
    dependencyHealth: number;
    revenueEffect: number;
  };
}

export interface PrioritizedSet<T> {
  /** Executable now, sorted by score descending. */
  ranked: PriorityItem<T>[];
  /** Governance-prohibited — score is irrelevant. */
  refused: PriorityItem<T>[];
  /** Requires a human — surfaced, not ranked. */
  deferred: PriorityItem<T>[];
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export class PriorityEngine {
  /**
   * autonomyFit: what fraction of the action is safely executable at the
   * current autonomy level. Required autonomy above the current level → 0.
   * Otherwise scaled by reversibility — an irreversible action is a worse
   * autonomous candidate than a reversible one at the same level.
   * Dependency health degrades fit directly: an action whose dependencies
   * are half-dead is half-executable.
   */
  private autonomyFit(a: ConditionAssessment, currentAutonomy: number): number {
    if (a.autonomyLevel > currentAutonomy) return 0;
    const reversibilityFit = clamp01(a.reversibility);
    const depFit = clamp01(a.dependencyHealth);
    return reversibilityFit * depFit;
  }

  /** Score a single condition at the given autonomy level. */
  score(assessment: ConditionAssessment, currentAutonomy: number): number {
    const fit = this.autonomyFit(assessment, currentAutonomy);
    const effort = Math.max(1, assessment.estimatedEffort);
    const revenueBoost = 1 + clamp01(Math.max(0, assessment.revenueEffect) / 10);
    return (assessment.impact * clamp01(assessment.confidence) * assessment.urgency * fit * revenueBoost) / effort;
  }

  /**
   * Rank a set of conditions. Each item carries its assessment; output
   * splits into ranked (executable), refused (governance), deferred
   * (human-required). Refused items always score 0.
   */
  prioritize<T>(
    items: Array<{ item: T; assessment: ConditionAssessment }>,
    currentAutonomy: number,
  ): PrioritizedSet<T> {
    const ranked: PriorityItem<T>[] = [];
    const refused: PriorityItem<T>[] = [];
    const deferred: PriorityItem<T>[] = [];

    for (const { item, assessment: a } of items) {
      const breakdown = {
        impact: a.impact,
        urgency: a.urgency,
        confidence: a.confidence,
        autonomyFit: this.autonomyFit(a, currentAutonomy),
        effort: Math.max(1, a.estimatedEffort),
        dependencyHealth: a.dependencyHealth,
        revenueEffect: a.revenueEffect,
      };

      // Governance first — a prohibited action is refused at any score.
      if (a.prohibited) {
        refused.push({ item, score: 0, refused: true, deferred: false, reason: a.prohibitionReason || 'prohibited', breakdown });
        continue;
      }
      // Human-required work is surfaced, never ranked as autonomous work.
      if (a.humanRequired) {
        deferred.push({ item, score: 0, refused: false, deferred: true, reason: 'human_required', breakdown });
        continue;
      }
      // Required autonomy above current level → refuse, don't rank.
      if (a.autonomyLevel > currentAutonomy) {
        refused.push({ item, score: 0, refused: true, deferred: false, reason: `autonomy:${a.autonomyLevel}>${currentAutonomy}`, breakdown });
        continue;
      }

      const score = this.score(a, currentAutonomy);
      ranked.push({ item, score, refused: false, deferred: false, breakdown });
    }

    ranked.sort((x, y) => y.score - x.score);
    return { ranked, refused, deferred };
  }
}
