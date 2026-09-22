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

/**
 * A verified diagnostic finding, as persisted in the latest
 * `diagnostic_followup` heidi_events row. The producer consumes these;
 * it never trusts diagnostic text as a capability name — the allowlist
 * below is the only mapping.
 */
export interface FindingRef {
  diagnosticEventId: string;
  taskTemplate: string;
  dimension?: string;
  severity?: string;
  summary?: string;
  humanRequired?: boolean;
}

/**
 * THE authoritative taskTemplate allowlist (E3). A finding's
 * `taskTemplate` string is an identity, never an instruction: it is
 * looked up here and mapped to a fixed capability + dimension. Anything
 * not in this table produces `unknown_template` and no mission.
 */
export const FINDING_TASK_ALLOWLIST: Record<
  string,
  { capabilityId: string; dimension: string }
> = {
  'ops.investigate_cognitive_timeouts': { capabilityId: 'ops.investigate_finding', dimension: 'cognitive_loop' },
  'ops.investigate_escalation_growth': { capabilityId: 'ops.investigate_finding', dimension: 'escalations' },
  'ops.investigate_runtime_drift': { capabilityId: 'ops.investigate_finding', dimension: 'runtime_drift' },
  'ops.investigate_stale_goals': { capabilityId: 'ops.investigate_finding', dimension: 'goals' },
};

const FINDING_MISSION_INTERVAL_MS = 20 * 60 * 60 * 1000;

export interface MissionProducerOptions {
  goals: GoalSystem;
  registry: CapabilityRegistry;
  /** Maximum open produced goals at any time. Default 2. */
  maxOpen?: number;
  /** Override the catalog (tests). Default: DEFAULT_MISSION_TEMPLATES. */
  templates?: MissionTemplate[];
  /**
   * Source of persisted, verified diagnostic findings (the latest
   * diagnostic_followup event). Injected so the producer stays hermetic
   * under test. Absent → the findings stage is skipped entirely.
   */
  findingSource?: () => Promise<FindingRef[]>;
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
  {
    producerKey: 'ops.diagnostic_followup',
    title: 'Investigate diagnostic findings',
    description: 'Read the latest executive diagnostic and produce bounded, evidence-backed investigation findings for each non-HEALTHY dimension. Investigates; never repairs.',
    purpose: 'Close the observe→diagnose→prioritize loop: verified findings become the input for the next bounded mission decision.',
    capabilityId: 'ops.diagnostic_followup',
    priority: 6,
    minIntervalMs: 24 * HOUR,
    reason: 'A diagnostic nobody investigates is telemetry, not self-maintenance; follow-up turns findings into evidence-backed next-step proposals.',
  },
  {
    producerKey: 'ops.coo_state',
    title: 'Refresh COO state',
    description: 'Collect the authoritative cross-domain COO state (deployment identity, work queues, escalations, ProtoForge, revenue counts) and derive the next authorized action.',
    purpose: 'Keep the executive operating state current so observations and next-action selection are evidence-based rather than stale.',
    capabilityId: 'ops.coo_state',
    priority: 5,
    minIntervalMs: 30 * 60 * 1000,
    reason: 'The COO state is only an operating state if it is continuously refreshed; each snapshot also embeds a full deployment reconciliation, giving periodic drift detection for free.',
  },
  {
    producerKey: 'ops.agent_supervise',
    title: 'Supervise agent control plane',
    description: 'Run one supervisor pass: persist stale/failed classifications, bounded-retry eligible missions, reconcile parent missions, escalate terminal failures to the human queue.',
    purpose: 'Keep multi-agent work honest — dead agents must not masquerade as running, terminal failures must reach the human, and parents must not complete over unresolved children.',
    capabilityId: 'ops.agent_supervise',
    priority: 5,
    minIntervalMs: 5 * 60 * 1000,
    reason: 'Supervision is only real on a cadence; between passes a crashed worker is an undetected ghost.',
  },
];

export class MissionProducer {
  private goals: GoalSystem;
  private registry: CapabilityRegistry;
  private maxOpen: number;
  private templates: MissionTemplate[];
  private findingSource: (() => Promise<FindingRef[]>) | null;

  constructor(opts: MissionProducerOptions) {
    this.goals = opts.goals;
    this.registry = opts.registry;
    this.maxOpen = opts.maxOpen ?? 2;
    this.templates = opts.templates ?? DEFAULT_MISSION_TEMPLATES;
    this.findingSource = opts.findingSource ?? null;
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

    if (this.findingSource) {
      await this.produceFromFindings(result, openByKey, autonomyLevel);
    }

    return result;
  }

  /**
   * E3: verified diagnostic finding → bounded investigation mission.
   *
   * Findings arrive already persisted (diagnostic_followup rows). Every
   * gate the fixed templates pass through applies here too — dedupe by
   * producerKey, cooldown, open cap, executability, R0/R1 risk ceiling.
   * A finding whose taskTemplate is not allowlisted, whose mapped
   * capability is not executable, or that is marked humanRequired
   * produces a skip record and nothing else.
   */
  private async produceFromFindings(
    result: ProductionResult,
    openByKey: Set<string>,
    autonomyLevel: number,
  ): Promise<void> {
    let findings: FindingRef[];
    try {
      findings = (await this.findingSource!()) ?? [];
    } catch {
      return; // A finding source that fails produces nothing — never invent findings.
    }

    for (const finding of findings) {
      // Malformed findings are rejected before they can name work.
      if (!finding || typeof finding.taskTemplate !== 'string' || finding.taskTemplate.length === 0) {
        result.skipped.push({ producerKey: 'finding:malformed', reason: 'malformed_finding' });
        continue;
      }

      const producerKey = `finding:${finding.taskTemplate}`;

      if (finding.humanRequired) {
        result.skipped.push({ producerKey, reason: 'human_required' });
        continue;
      }

      const binding = FINDING_TASK_ALLOWLIST[finding.taskTemplate];
      if (!binding) {
        result.skipped.push({ producerKey, reason: 'unknown_template' });
        continue;
      }

      if (openByKey.size >= this.maxOpen) {
        result.skipped.push({ producerKey, reason: `open_cap:${this.maxOpen}` });
        continue;
      }
      if (openByKey.has(producerKey)) {
        result.skipped.push({ producerKey, reason: 'already_open' });
        continue;
      }

      const exec = this.registry.isExecutable(binding.capabilityId, autonomyLevel);
      if (!exec.executable) {
        result.skipped.push({ producerKey, reason: `not_executable:${exec.reason}` });
        continue;
      }
      const cap = this.registry.get(binding.capabilityId);
      if (!cap || (cap.riskLevel !== 'R0' && cap.riskLevel !== 'R1')) {
        result.skipped.push({ producerKey, reason: `risk_level:${cap?.riskLevel ?? 'unknown'}` });
        continue;
      }

      const latest = await this.goals.getLatestByProducerKey(producerKey);
      if (latest && Date.now() - new Date(latest.createdAt).getTime() < FINDING_MISSION_INTERVAL_MS) {
        result.skipped.push({ producerKey, reason: 'cooldown' });
        continue;
      }

      const goal = await this.goals.createGoal({
        goalType: 'mission',
        title: `Investigate ${binding.dimension}`,
        description:
          `Bounded investigation of diagnostic finding "${finding.taskTemplate}". ` +
          'INVESTIGATION ONLY — no repair authorized.',
        purpose: finding.summary ?? `Diagnostic finding ${finding.taskTemplate}`,
        priority: 6,
        context: {
          producerKey,
          producedBy: PRODUCER_ID,
          producedAt: new Date().toISOString(),
          reason:
            `Verified diagnostic finding ${finding.taskTemplate} (severity ${finding.severity ?? 'unknown'}) ` +
            'requires bounded investigation. Investigation only; no repair authorized.',
          capabilityId: binding.capabilityId,
          capabilityParams: {
            dimension: binding.dimension,
            taskTemplate: finding.taskTemplate,
            diagnosticEventId: finding.diagnosticEventId,
          },
          diagnosticEventId: finding.diagnosticEventId,
          findingSummary: finding.summary ?? null,
          investigationOnly: true,
          noRepairAuthorized: true,
          completeOnVerify: true,
        },
      });

      openByKey.add(producerKey);
      result.created.push(goal);
    }
  }
}
