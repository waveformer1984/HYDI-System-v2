/**
 * HEIDI Mission Producer
 *
 * The governed producer that closes the observer-loop gap found in the
 * Phase A autonomy audit: the cognitive loop can consume `heidi_goals`,
 * but nothing wrote them, so every cycle degraded to `cognitive.observe`.
 *
 * This producer emits MISSION goals from a fixed, code-level catalog.
 * Every template is bound to a concrete capability and only produced when
 * the CapabilityRegistry says that capability is executable at the
 * current autonomy level — which structurally excludes R2+ at level 2 and
 * everything R3/R4/R5 regardless. The producer can narrow what runs; it
 * can never widen the authorization envelope.
 *
 * Bounds (all enforced, none configurable at runtime):
 *   - Idempotent: at most one OPEN goal per `producerKey` at a time.
 *   - Rate-limited: a producerKey cannot re-emit until `minIntervalMs`
 *     has passed since its most recent goal (any status).
 *   - Capped: at most `maxOpen` producer-created goals open at once.
 *   - Auditable: `context.reason` records why the goal was created.
 */

import type { Goal, GoalSystem } from './GoalSystem';
import type { CapabilityRegistry } from './CapabilityRegistry';

export const PRODUCER_ID = 'heidi-mission-producer';
const OPEN_STATUSES = new Set(['pending', 'active', 'in_progress', 'blocked']);

export interface MissionTemplate {
  /** Stable dedupe identity — stored in goal.context.producerKey. */
  producerKey: string;
  title: string;
  description: string;
  purpose: string;
  /** The capability this mission delegates to via context.capabilityId. */
  capabilityId: string;
  capabilityParams?: Record<string, unknown>;
  priority?: number;
  /** Minimum time between goals produced under this key. */
  minIntervalMs: number;
  /** Why this mission exists — persisted on the goal for audit. */
  reason: string;
}

export interface ProductionResult {
  created: Goal[];
  skipped: Array<{ producerKey: string; reason: string }>;
}

export interface MissionProducerOptions {
  goals: GoalSystem;
  registry: CapabilityRegistry;
  /** Maximum open produced goals at any time. Default 2. */
  maxOpen?: number;
  /** Override the catalog (tests). Default: DEFAULT_MISSION_TEMPLATES. */
  templates?: MissionTemplate[];
}

const HOUR = 60 * 60 * 1000;

/**
 * The bounded catalog. Templates reference capabilities that are wired
 * unconditionally (world.sync) or whenever self-sufficiency is enabled
 * (self_sufficiency.check_all_capabilities). Both are R0; a template
 * pointing at an unwired or non-executable capability is skipped, never
 * forced.
 */
export const DEFAULT_MISSION_TEMPLATES: MissionTemplate[] = [
  {
    producerKey: 'ops.world_sync',
    title: 'Synchronize world model with runtime',
    description: 'Run a world.sync pass so heidi_world_model reflects the live runtime rather than stale boot-time state.',
    purpose: 'Keep the shared world model truthful so planning and health answers are evidence-based.',
    capabilityId: 'world.sync',
    priority: 6,
    minIntervalMs: 4 * HOUR,
    reason: 'World model drifts between syncs; a scheduled refresh keeps perception grounded in the live runtime.',
  },
  {
    producerKey: 'ops.capability_health',
    title: 'Verify capability health posture',
    description: 'Probe all registered capabilities (DB, Ollama, credentials) and record the ready/blocked summary.',
    purpose: 'Produce a fresh, evidence-backed capability posture instead of relying on the last boot-time probe.',
    capabilityId: 'self_sufficiency.check_all_capabilities',
    priority: 5,
    minIntervalMs: 4 * HOUR,
    reason: 'Capability readiness changes over time; periodic probing catches silent degradation before it blocks work.',
  },
  {
    producerKey: 'ops.executive_diagnostic',
    title: 'Run executive self-diagnostic',
    description: 'Collect a multi-dimension diagnostic (loop liveness, goal staleness, mission cadence, memory, authorizations, escalations, deployment drift, capability posture) and persist it as a heidi_events row.',
    purpose: 'Produce a periodic, evidence-backed executive assessment instead of relying on on-demand status endpoints.',
    capabilityId: 'ops.executive_diagnostic',
    priority: 7,
    minIntervalMs: 24 * HOUR,
    reason: 'Self-observation is only real if it runs on a cadence; a daily persisted diagnostic is the executive feedback loop\'s evidence stream.',
  },
];

export class MissionProducer {
  private goals: GoalSystem;
  private registry: CapabilityRegistry;
  private maxOpen: number;
  private templates: MissionTemplate[];

  constructor(opts: MissionProducerOptions) {
    this.goals = opts.goals;
    this.registry = opts.registry;
    this.maxOpen = opts.maxOpen ?? 2;
    this.templates = opts.templates ?? DEFAULT_MISSION_TEMPLATES;
  }

  /**
   * Emit any due missions. `openGoals` is the caller's already-fetched
   * open work set (getPendingWork); it is used for the open-dedupe check
   * so a produce pass costs at most one extra query per candidate.
   */
  async produce(openGoals: Goal[], autonomyLevel: number): Promise<ProductionResult> {
    const result: ProductionResult = { created: [], skipped: [] };

    const openByKey = new Set(
      openGoals
        .filter((g) => OPEN_STATUSES.has(g.status) && g.context?.producerKey)
        .map((g) => g.context.producerKey as string),
    );

    for (const template of this.templates) {
      if (openByKey.size >= this.maxOpen) {
        result.skipped.push({ producerKey: template.producerKey, reason: `open_cap:${this.maxOpen}` });
        continue;
      }

      if (openByKey.has(template.producerKey)) {
        result.skipped.push({ producerKey: template.producerKey, reason: 'already_open' });
        continue;
      }

      // Authorization gate: the capability must be executable NOW — wired
      // executor, available status, autonomy requirement met. This is the
      // same check the cycle's authorize phase will apply; failing here
      // means the mission would be produced only to be refused.
      const exec = this.registry.isExecutable(template.capabilityId, autonomyLevel);
      if (!exec.executable) {
        result.skipped.push({ producerKey: template.producerKey, reason: `not_executable:${exec.reason}` });
        continue;
      }

      // Defense in depth: even if isExecutable passed, never produce work
      // classified above the autonomous reversible ceiling.
      const cap = this.registry.get(template.capabilityId);
      if (!cap || (cap.riskLevel !== 'R0' && cap.riskLevel !== 'R1')) {
        result.skipped.push({ producerKey: template.producerKey, reason: `risk_level:${cap?.riskLevel ?? 'unknown'}` });
        continue;
      }

      // Cooldown: do not re-emit a key until minIntervalMs after its most
      // recent goal — this is what prevents a completed mission from being
      // instantly recreated every cycle.
      const latest = await this.goals.getLatestByProducerKey(template.producerKey);
      if (latest && Date.now() - new Date(latest.createdAt).getTime() < template.minIntervalMs) {
        result.skipped.push({ producerKey: template.producerKey, reason: 'cooldown' });
        continue;
      }

      const goal = await this.goals.createGoal({
        goalType: 'mission',
        title: template.title,
        description: template.description,
        purpose: template.purpose,
        priority: template.priority ?? 5,
        context: {
          producerKey: template.producerKey,
          producedBy: PRODUCER_ID,
          producedAt: new Date().toISOString(),
          reason: template.reason,
          capabilityId: template.capabilityId,
          capabilityParams: template.capabilityParams ?? {},
          completeOnVerify: true,
        },
      });

      openByKey.add(template.producerKey);
      result.created.push(goal);
    }

    return result;
  }
}
