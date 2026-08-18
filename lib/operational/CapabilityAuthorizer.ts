/**
 * HYDI Security Boundaries — Capability Authorization
 *
 * Defines explicit recovery capabilities. Each capability must have:
 * - authorization (is it permitted?)
 * - scope (which targets are allowed?)
 * - audit record (every check is logged)
 *
 * The autonomous system CANNOT:
 * - expose secrets
 * - modify credentials arbitrarily
 * - execute unrestricted shell commands
 * - perform live payment operations
 * - delete production data
 * - alter Git history
 * - push arbitrary branches
 *
 * Recovery actions are represented structurally (AllowedCommand), never as
 * arbitrary user-generated shell strings. The policy engine decides whether
 * a requested action is permitted.
 *
 * Principle: identity decides permission, not reality.
 */

import { randomUUID } from 'crypto';
import type {
  Capability,
  CapabilityAuthorization,
  OperationalEvent,
} from './types';
import type { SystemStateModel } from './SystemStateModel';

/**
 * The set of allowed boot.config.json module IDs that may be restarted.
 * This is derived from the actual boot config, not user input.
 */
const RESTARTABLE_MODULES = new Set([
  'protoforge-core',
  'heidi-web',
  'heidi-mobile-chat',
]);

/**
 * Modules that must NEVER be auto-restarted by the recovery engine.
 */
const PROTECTED_MODULES = new Set<string>([
  // Add modules that should never be auto-restarted here
]);

export interface CapabilityContext {
  /** Who or what is requesting the capability. */
  requester: string;
  /** The target component ID (if applicable). */
  target?: string;
  /** Additional context. */
  detail?: Record<string, unknown>;
}

export class CapabilityAuthorizer {
  private stateModel: SystemStateModel;
  private deniedCount = 0;

  constructor(stateModel: SystemStateModel) {
    this.stateModel = stateModel;
  }

  /**
   * Check whether a capability is authorized for the given context.
   * Returns the authorization result and logs an audit event.
   */
  authorize(capability: Capability, ctx: CapabilityContext): CapabilityAuthorization {
    const auth = this.evaluate(capability, ctx);

    if (!auth.authorized) {
      this.deniedCount++;
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'capability_denied',
        component: ctx.target ?? 'system',
        cause: `capability ${capability} denied for ${ctx.requester}`,
        action: capability,
        actionResult: 'denied',
        detail: { ...ctx.detail, reason: auth.reason },
      });
    }

    return auth;
  }

  /**
   * Get the count of denied actions (for diagnostics).
   */
  getDeniedCount(): number {
    return this.deniedCount;
  }

  /**
   * Get the list of all capabilities with their current authorization state.
   * Used for diagnostic snapshots.
   */
  getAllCapabilities(): CapabilityAuthorization[] {
    const caps: Capability[] = [
      'health.read',
      'health.recover',
      'process.restart',
      'process.kill',
      'database.recover',
      'configuration.validate',
      'runtime.probe',
      'diagnostic.snapshot',
    ];
    return caps.map((c) => this.evaluate(c, { requester: 'diagnostic' }));
  }

  private evaluate(capability: Capability, ctx: CapabilityContext): CapabilityAuthorization {
    switch (capability) {
      case 'health.read':
        // Always authorized — reading health is safe
        return { capability, authorized: true, scope: ['*'] };

      case 'health.recover':
        // Authorized only for known boot modules
        if (ctx.target && RESTARTABLE_MODULES.has(ctx.target)) {
          return { capability, authorized: true, scope: [ctx.target] };
        }
        if (ctx.target && PROTECTED_MODULES.has(ctx.target)) {
          return { capability, authorized: false, reason: `${ctx.target} is protected`, scope: [] };
        }
        return { capability, authorized: false, reason: 'target not in restartable set', scope: [] };

      case 'process.restart':
        // Only specific boot.config.json modules, never arbitrary processes
        if (!ctx.target) {
          return { capability, authorized: false, reason: 'no target specified', scope: [] };
        }
        if (PROTECTED_MODULES.has(ctx.target)) {
          return { capability, authorized: false, reason: `${ctx.target} is protected`, scope: [] };
        }
        if (!RESTARTABLE_MODULES.has(ctx.target)) {
          return { capability, authorized: false, reason: `${ctx.target} not in allowed restart set`, scope: [] };
        }
        return { capability, authorized: true, scope: [ctx.target] };

      case 'process.kill':
        // Same restrictions as restart
        return this.evaluate('process.restart', ctx);

      case 'database.recover':
        // Database recovery is limited to waiting — no destructive actions
        return { capability, authorized: true, scope: ['database'] };

      case 'configuration.validate':
        // Read-only validation is always safe
        return { capability, authorized: true, scope: ['*'] };

      case 'runtime.probe':
        // Functional probes are read-only
        return { capability, authorized: true, scope: ['*'] };

      case 'diagnostic.snapshot':
        // Always safe — read-only diagnostic
        return { capability, authorized: true, scope: ['*'] };

      default:
        return { capability, authorized: false, reason: 'unknown capability', scope: [] };
    }
  }

  /**
   * Check if a target module is in the restartable set.
   */
  isRestartable(target: string): boolean {
    return RESTARTABLE_MODULES.has(target) && !PROTECTED_MODULES.has(target);
  }

  /**
   * Get the restartable modules list (for diagnostics).
   */
  getRestartableModules(): string[] {
    return [...RESTARTABLE_MODULES].filter((m) => !PROTECTED_MODULES.has(m));
  }
}
