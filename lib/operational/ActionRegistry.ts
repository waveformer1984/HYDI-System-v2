/**
 * HYDI Recovery Action Registry
 *
 * One authoritative registry of all recoverable actions HEIDI can take.
 * Every action specifies its target, risk, reversibility, timeout, retry
 * policy, cooldown, expected state transition, verification strategy, and
 * escalation behavior.
 *
 * HEIDI must operate through bounded, typed, auditable capabilities.
 * No action exists outside this registry.
 */

import type { ActionRegistryEntry, RecoveryPolicyId, ComponentState } from './types';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_COOLDOWN_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 3;

function entry(
  actionId: string,
  actionType: RecoveryPolicyId,
  targetComponent: string,
  purpose: string,
  opts: {
    riskLevel: ActionRegistryEntry['riskLevel'];
    authorizationClass: ActionRegistryEntry['authorizationClass'];
    reversibility: ActionRegistryEntry['reversibility'];
    timeoutMs?: number;
    maxAttempts?: number;
    cooldownMs?: number;
    expectedFrom?: ComponentState;
    expectedTo?: ComponentState;
    verificationStrategy?: string;
  },
): ActionRegistryEntry {
  return {
    actionId,
    actionType,
    targetComponent,
    purpose,
    prerequisites: [`${targetComponent} is not HEALTHY`],
    authorizationClass: opts.authorizationClass,
    riskLevel: opts.riskLevel,
    reversibility: opts.reversibility,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryPolicy: {
      maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      cooldownMs: opts.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    },
    cooldownMs: opts.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    expectedStateTransition: {
      from: opts.expectedFrom ?? 'UNAVAILABLE',
      to: opts.expectedTo ?? 'HEALTHY',
    },
    verificationStrategy: opts.verificationStrategy ?? 'health endpoint returns 200 with valid body + process identity verified',
    escalationBehavior: 'escalate to human operator — all recovery attempts exhausted',
  };
}

/**
 * The default action registry. Maps component IDs to their recovery actions.
 */
export const DEFAULT_ACTION_REGISTRY: ActionRegistryEntry[] = [
  // --- Process restart actions (R1, autonomous) ---
  entry('restart.protoforge-core', 'restart_process', 'protoforge-core',
    'Restart the ProtoForge core process from boot.config.json',
    { riskLevel: 'R1', authorizationClass: 'autonomous', reversibility: 'reversible',
      timeoutMs: 30000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  entry('restart.heidi-web', 'restart_process', 'heidi-web',
    'Restart the Heidi Web (Next.js) process from boot.config.json',
    { riskLevel: 'R1', authorizationClass: 'autonomous', reversibility: 'reversible',
      timeoutMs: 60000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  entry('restart.heidi-mobile-chat', 'restart_process', 'heidi-mobile-chat',
    'Restart the Heidi Mobile Chat process from boot.config.json',
    { riskLevel: 'R1', authorizationClass: 'autonomous', reversibility: 'reversible',
      timeoutMs: 30000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  // --- Container restart actions (R2, policy_authorized) ---
  entry('restart.supabase_db', 'restart_container', 'supabase_db',
    'Restart the local Supabase PostgreSQL database container',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 30000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY',
      verificationStrategy: 'database write/read/delete proof + port 54322 listening' }),

  entry('restart.supabase_rest', 'restart_container', 'supabase_rest',
    'Restart the local Supabase REST API (PostgREST) container',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 20000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  entry('restart.supabase_auth', 'restart_container', 'supabase_auth',
    'Restart the local Supabase Auth (GoTrue) container',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 20000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  entry('restart.supabase_realtime', 'restart_container', 'supabase_realtime',
    'Restart the local Supabase Realtime container',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 20000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  entry('restart.supabase_kong', 'restart_container', 'supabase_kong',
    'Restart the local Supabase Kong API gateway container',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 20000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY' }),

  // --- Ollama restart (R2, policy_authorized) ---
  entry('restart.ollama', 'restart_ollama', 'ollama',
    'Restart the local Ollama AI service',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 15000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY',
      verificationStrategy: 'Ollama /api/tags responds with model list' }),

  // --- Database recovery (R2, policy_authorized) ---
  entry('recover.database', 'recover_database', 'database',
    'Recover database connectivity by restarting local Supabase DB container',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 30000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY',
      verificationStrategy: 'database write/read/delete proof' }),

  // --- Bridge restart (R1-R3 depending on bridge) ---
  entry('restart.bridge', 'restart_bridge', 'bridge',
    'Restart a bridge component (if it is a registered process module)',
    { riskLevel: 'R2', authorizationClass: 'policy_authorized', reversibility: 'reversible',
      timeoutMs: 30000, expectedFrom: 'UNAVAILABLE', expectedTo: 'HEALTHY',
      verificationStrategy: 'bridge functional probe succeeds' }),

  // --- Escalation (R0, always available) ---
  entry('escalate.default', 'escalate', '*',
    'Escalate to human operator when recovery is exhausted or unsafe',
    { riskLevel: 'R0', authorizationClass: 'autonomous', reversibility: 'reversible',
      timeoutMs: 1000, maxAttempts: 1, cooldownMs: 0,
      expectedFrom: 'FAILED', expectedTo: 'ESCALATION_REQUIRED',
      verificationStrategy: 'escalation package created with evidence and recommended action' }),
];

/**
 * The action registry manager.
 * Provides lookup, validation, and listing of registered actions.
 */
export class ActionRegistry {
  private entries: Map<string, ActionRegistryEntry> = new Map();

  constructor(entries: ActionRegistryEntry[] = DEFAULT_ACTION_REGISTRY) {
    for (const e of entries) {
      this.entries.set(e.actionId, e);
    }
  }

  /**
   * Get all registered actions.
   */
  getAll(): ActionRegistryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Get actions for a specific component.
   */
  getForComponent(component: string): ActionRegistryEntry[] {
    return this.getAll().filter(
      (e) => e.targetComponent === component || e.targetComponent === '*',
    );
  }

  /**
   * Get a specific action by ID.
   */
  get(actionId: string): ActionRegistryEntry | null {
    return this.entries.get(actionId) ?? null;
  }

  /**
   * Find the best action for a component given its current state.
   * Returns the first matching action with the lowest risk level.
   */
  selectActionForComponent(component: string, currentState: ComponentState): ActionRegistryEntry | null {
    const candidates = this.getForComponent(component)
      .filter((e) => e.expectedStateTransition.from === currentState)
      .sort((a, b) => {
        // Lower risk = higher priority
        const riskOrder = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5 };
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      });
    return candidates[0] ?? null;
  }

  /**
   * Check if an action is authorized for autonomous execution.
   */
  isAutonomous(actionId: string): boolean {
    const e = this.get(actionId);
    if (!e) return false;
    return e.authorizationClass === 'autonomous';
  }

  /**
   * Check if an action requires human authorization.
   */
  requiresHuman(actionId: string): boolean {
    const e = this.get(actionId);
    if (!e) return true; // unknown actions require human
    return e.authorizationClass === 'human_required' || e.authorizationClass === 'prohibited';
  }

  /**
   * Register a new action (for testing or extensibility).
   */
  register(entry: ActionRegistryEntry): void {
    this.entries.set(entry.actionId, entry);
  }

  /**
   * Get a summary for display.
   */
  summary(): Array<{
    actionId: string;
    actionType: string;
    target: string;
    risk: string;
    authorization: string;
    reversible: boolean;
  }> {
    return this.getAll().map((e) => ({
      actionId: e.actionId,
      actionType: e.actionType,
      target: e.targetComponent,
      risk: e.riskLevel,
      authorization: e.authorizationClass,
      reversible: e.reversibility === 'reversible',
    }));
  }
}

/**
 * Singleton instance.
 */
export const actionRegistry = new ActionRegistry();
