/**
 * HYDI Action Capability Registry
 *
 * The registry of all human-action capabilities HYDI can perform.
 * This EXTENDS the existing heidi/CapabilityRegistry — it does not replace it.
 *
 * Each capability declares:
 *   - risk level (mapped to existing R0-R5)
 *   - required authorization scope
 *   - allowed targets
 *   - whether human approval is required
 *   - whether reversible
 *   - verification requirements
 *   - which adapter handles it
 *
 * Capabilities are registered from adapters. Unregistered capabilities
 * are reported as UNSUPPORTED — HYDI never claims a capability it doesn't have.
 */

import type { RiskLevel } from '../operational/types';
import type {
  ActionCapabilityDescriptor,
  ActionCapabilityStatus,
  ActionCategory,
  ActionRiskLabel,
  AuthorizationMode,
  AuthorizationScope,
  LifecycleCapability,
  Reversibility,
  RetryPolicy,
  RollbackStrategy,
  TargetPattern,
  VerificationStrategy,
} from './HumanActionTypes';

export class ActionCapabilityRegistry {
  private capabilities: Map<string, ActionCapabilityDescriptor> = new Map();
  private adapterCapabilities: Map<string, Set<string>> = new Map();

  /**
   * Register a capability. If the adapter is not available, the capability
   * is marked as UNSUPPORTED rather than silently failing.
   */
  register(descriptor: Omit<ActionCapabilityDescriptor, 'status' | 'healthNote'>): void {
    const fullDescriptor: ActionCapabilityDescriptor = {
      ...descriptor,
      status: this.determineInitialStatus(descriptor),
      healthNote: null,
    };
    this.capabilities.set(descriptor.capabilityId, fullDescriptor);

    // Track which adapter handles this capability
    const adapterId = descriptor.adapterId;
    if (!this.adapterCapabilities.has(adapterId)) {
      this.adapterCapabilities.set(adapterId, new Set());
    }
    this.adapterCapabilities.get(adapterId)!.add(descriptor.capabilityId);
  }

  /**
   * Update a capability's status based on adapter availability.
   */
  updateStatus(capabilityId: string, status: ActionCapabilityStatus, healthNote?: string): void {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return;
    cap.status = status;
    if (healthNote !== undefined) {
      cap.healthNote = healthNote;
    }
  }

  /**
   * Update all capabilities for an adapter based on adapter availability.
   */
  updateAdapterStatus(adapterId: string, available: boolean, reason: string | null): void {
    const caps = this.adapterCapabilities.get(adapterId);
    if (!caps) return;
    for (const capId of caps) {
      const cap = this.capabilities.get(capId);
      if (!cap) continue;
      if (!available) {
        cap.status = reason?.includes('not installed') || reason?.includes('not configured')
          ? 'UNSUPPORTED'
          : 'BLOCKED';
        cap.healthNote = reason;
      } else {
        // Restore to available if it was blocked due to adapter unavailability
        if (cap.status === 'BLOCKED' || cap.status === 'UNSUPPORTED') {
          cap.status = cap.authorizationMode === 'human_required'
            ? 'REQUIRES_AUTHORIZATION'
            : 'AVAILABLE';
          cap.healthNote = null;
        }
      }
    }
  }

  /**
   * Get a capability descriptor.
   */
  get(capabilityId: string): ActionCapabilityDescriptor | null {
    return this.capabilities.get(capabilityId) ?? null;
  }

  /**
   * List all capabilities.
   */
  listAll(): ActionCapabilityDescriptor[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * List capabilities by category.
   */
  listByCategory(category: ActionCategory): ActionCapabilityDescriptor[] {
    return this.listAll().filter((c) => c.category === category);
  }

  /**
   * List capabilities by adapter.
   */
  listByAdapter(adapterId: string): ActionCapabilityDescriptor[] {
    const capIds = this.adapterCapabilities.get(adapterId);
    if (!capIds) return [];
    return Array.from(capIds)
      .map((id) => this.capabilities.get(id))
      .filter((c): c is ActionCapabilityDescriptor => c !== undefined);
  }

  /**
   * List capabilities by risk level.
   */
  listByRisk(risk: RiskLevel): ActionCapabilityDescriptor[] {
    return this.listAll().filter((c) => c.risk === risk);
  }

  /**
   * List capabilities available at a given authorization scope.
   */
  listAvailableForScope(scope: AuthorizationScope): ActionCapabilityDescriptor[] {
    const scopeRank: Record<AuthorizationScope, number> = {
      READ_ONLY: 0,
      LOCAL_WRITE: 1,
      SERVICE_OPERATION: 2,
      EXTERNAL_COMMUNICATION: 3,
      ACCOUNT_CONFIGURATION: 4,
      CREDENTIAL_MANAGEMENT: 5,
      DEPLOYMENT: 6,
      FINANCIAL: 7,
      DESTRUCTIVE: 8,
    };
    const grantedRank = scopeRank[scope];
    return this.listAll().filter(
      (c) => scopeRank[c.authorizationScope] <= grantedRank && c.status === 'AVAILABLE',
    );
  }

  /**
   * Check if a capability is available and authorized.
   */
  isExecutable(
    capabilityId: string,
    grantedScopes: AuthorizationScope[],
  ): { executable: boolean; reason: string; descriptor: ActionCapabilityDescriptor | null } {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' is not registered — HYDI cannot perform this action`,
        descriptor: null,
      };
    }
    if (cap.status === 'UNSUPPORTED') {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' is UNSUPPORTED: ${cap.healthNote ?? 'adapter not available'}`,
        descriptor: cap,
      };
    }
    if (cap.status === 'BLOCKED') {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' is BLOCKED: ${cap.healthNote ?? 'dependency missing'}`,
        descriptor: cap,
      };
    }
    if (cap.status === 'DISABLED') {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' is DISABLED by policy`,
        descriptor: cap,
      };
    }
    if (!grantedScopes.includes(cap.authorizationScope)) {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' requires scope '${cap.authorizationScope}', granted: [${grantedScopes.join(', ')}]`,
        descriptor: cap,
      };
    }
    if (cap.authorizationMode === 'prohibited') {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' is PROHIBITED`,
        descriptor: cap,
      };
    }
    return {
      executable: true,
      reason: 'Capability is available and authorized',
      descriptor: cap,
    };
  }

  /**
   * Answer "What can you do?" — returns all capabilities with their states.
   */
  describeCapabilities(): Array<{
    category: ActionCategory;
    capabilityId: string;
    name: string;
    status: ActionCapabilityStatus;
    riskLabel: ActionRiskLabel;
    lifecycleCapability: LifecycleCapability;
    requiresHumanApproval: boolean;
    healthNote: string | null;
  }> {
    return this.listAll().map((c) => ({
      category: c.category,
      capabilityId: c.capabilityId,
      name: c.name,
      status: c.status,
      riskLabel: c.riskLabel,
      lifecycleCapability: c.lifecycleCapability,
      requiresHumanApproval: c.requiresHumanApproval,
      healthNote: c.healthNote,
    }));
  }

  /**
   * Get capabilities grouped by category for display.
   */
  describeByCategory(): Record<ActionCategory, ActionCapabilityDescriptor[]> {
    const result: Partial<Record<ActionCategory, ActionCapabilityDescriptor[]>> = {};
    for (const cap of this.listAll()) {
      if (!result[cap.category]) {
        result[cap.category] = [];
      }
      result[cap.category]!.push(cap);
    }
    return result as Record<ActionCategory, ActionCapabilityDescriptor[]>;
  }

  private determineInitialStatus(
    descriptor: Omit<ActionCapabilityDescriptor, 'status' | 'healthNote'>,
  ): ActionCapabilityStatus {
    if (descriptor.lifecycleCapability === 'UNSUPPORTED') {
      return 'UNSUPPORTED';
    }
    // Capabilities start as BLOCKED until an adapter is registered
    // The adapter registration will update the status to AVAILABLE
    if (descriptor.authorizationMode === 'human_required') {
      return 'REQUIRES_AUTHORIZATION';
    }
    return 'BLOCKED';
  }
}

// ---------------------------------------------------------------------------
// Default capability definitions — registered by the bootstrap function
// ---------------------------------------------------------------------------

/**
 * Default retry policy for low-risk actions.
 */
const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 1,
  cooldownMs: 1000,
  backoffMultiplier: 2,
  retryableErrors: ['timeout', 'temporary_unavailable'],
};

/**
 * Default retry policy for actions that should retry.
 */
const RETRY_WITH_BACKOFF: RetryPolicy = {
  maxAttempts: 3,
  cooldownMs: 2000,
  backoffMultiplier: 2,
  retryableErrors: ['timeout', 'temporary_unavailable', 'connection_reset'],
};

// Common rollback strategies
const NO_ROLLBACK: RollbackStrategy = {
  type: 'not_possible',
  description: 'This action cannot be rolled back automatically',
};

const BACKUP_ROLLBACK: RollbackStrategy = {
  type: 'backup_restore',
  description: 'A backup will be created before execution and can be restored',
};

const UNDO_ROLLBACK: RollbackStrategy = {
  type: 'undo_operation',
  description: 'The inverse operation will be performed to undo',
};

// Common verification strategies
const FILE_EXISTS_VERIFY: VerificationStrategy = {
  type: 'file_exists',
  description: 'Verify the file exists at the target path',
};

const PROCESS_RUNNING_VERIFY: VerificationStrategy = {
  type: 'process_running',
  description: 'Verify the process is running',
};

const HTTP_RESPONSE_VERIFY: VerificationStrategy = {
  type: 'api_response',
  description: 'Verify the HTTP response status code',
};

const STATE_CHECK_VERIFY: VerificationStrategy = {
  type: 'state_check',
  description: 'Verify the system state matches expected',
};

/**
 * Capability definitions for each category.
 * These are registered by the bootstrap function below.
 */
export interface CapabilityDefinition {
  capabilityId: string;
  category: ActionCategory;
  name: string;
  description: string;
  risk: RiskLevel;
  riskLabel: ActionRiskLabel;
  authorizationScope: AuthorizationScope;
  authorizationMode: AuthorizationMode;
  reversible: Reversibility;
  allowedTargets: TargetPattern[];
  requiresHumanApproval: boolean;
  verificationRequirements: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  rollbackStrategyTemplate: RollbackStrategy;
  verificationStrategyTemplate: VerificationStrategy;
  adapterId: string;
  lifecycleCapability: LifecycleCapability;
}

export const SYSTEM_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'filesystem.read_file',
    category: 'SYSTEM',
    name: 'Read File',
    description: 'Read the contents of a file',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'Any file path' }],
    requiresHumanApproval: false, verificationRequirements: 'File exists and is readable',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: FILE_EXISTS_VERIFY, adapterId: 'filesystem',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'filesystem.write_file',
    category: 'SYSTEM',
    name: 'Write File',
    description: 'Write content to a file (creates or overwrites)',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'autonomous', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'Any file path' }],
    requiresHumanApproval: false, verificationRequirements: 'File exists with expected content',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: BACKUP_ROLLBACK,
    verificationStrategyTemplate: FILE_EXISTS_VERIFY, adapterId: 'filesystem',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'filesystem.create_directory',
    category: 'SYSTEM',
    name: 'Create Directory',
    description: 'Create a new directory',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'Any directory path' }],
    requiresHumanApproval: false, verificationRequirements: 'Directory exists',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: FILE_EXISTS_VERIFY, adapterId: 'filesystem',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'filesystem.move_file',
    category: 'SYSTEM',
    name: 'Move/Rename File',
    description: 'Move or rename a file',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'Any file path' }],
    requiresHumanApproval: false, verificationRequirements: 'File exists at new path, not at old',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: FILE_EXISTS_VERIFY, adapterId: 'filesystem',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'filesystem.delete_file',
    category: 'SYSTEM',
    name: 'Delete File',
    description: 'Delete a file (DANGEROUS — backup created first)',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'DESTRUCTIVE',
    authorizationMode: 'human_required', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/*', description: 'Any file path' }],
    requiresHumanApproval: true, verificationRequirements: 'File no longer exists',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: BACKUP_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'filesystem',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'process.execute',
    category: 'SYSTEM',
    name: 'Execute Process',
    description: 'Execute a structured command (NOT arbitrary shell — allowlist enforced)',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'policy_authorized', reversible: 'UNKNOWN',
    allowedTargets: [{ type: 'module_id', pattern: '*', description: 'Allowlisted commands only' }],
    requiresHumanApproval: false, verificationRequirements: 'Exit code and output verified',
    timeoutMs: 30000, retryPolicy: RETRY_WITH_BACKOFF, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'process',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'process.inspect',
    category: 'SYSTEM',
    name: 'Inspect Process',
    description: 'Inspect a running process',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any process' }],
    requiresHumanApproval: false, verificationRequirements: 'Process info retrieved',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'process',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'process.start',
    category: 'SYSTEM',
    name: 'Start Process',
    description: 'Start a process from the allowlist',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'policy_authorized', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'module_id', pattern: '*', description: 'Allowlisted modules only' }],
    requiresHumanApproval: false, verificationRequirements: 'Process is running',
    timeoutMs: 15000, retryPolicy: RETRY_WITH_BACKOFF, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: PROCESS_RUNNING_VERIFY, adapterId: 'process',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'process.stop',
    category: 'SYSTEM',
    name: 'Stop Process',
    description: 'Stop a running process (graceful)',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'human_required', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'module_id', pattern: '*', description: 'Allowlisted modules only' }],
    requiresHumanApproval: true, verificationRequirements: 'Process is no longer running',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'process',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
];

export const NETWORK_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'network.http_request',
    category: 'NETWORK',
    name: 'HTTP Request',
    description: 'Make an HTTP request to a URL',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'url_pattern', pattern: '*', description: 'Any URL' }],
    requiresHumanApproval: false, verificationRequirements: 'HTTP response status checked',
    timeoutMs: 15000, retryPolicy: RETRY_WITH_BACKOFF, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: HTTP_RESPONSE_VERIFY, adapterId: 'http',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'network.dns_lookup',
    category: 'NETWORK',
    name: 'DNS Lookup',
    description: 'Perform a DNS lookup',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any hostname' }],
    requiresHumanApproval: false, verificationRequirements: 'DNS response received',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'http',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'network.connectivity_test',
    category: 'NETWORK',
    name: 'Connectivity Test',
    description: 'Test connectivity to a host:port',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any host:port' }],
    requiresHumanApproval: false, verificationRequirements: 'Connection result recorded',
    timeoutMs: 5000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'http',
    lifecycleCapability: 'AUTOMATED',
  },
];

export const BROWSER_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'browser.navigate',
    category: 'BROWSER',
    name: 'Navigate to URL',
    description: 'Navigate the browser to a URL',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'url_pattern', pattern: '*', description: 'Any URL' }],
    requiresHumanApproval: false, verificationRequirements: 'Page URL matches expected',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'browser.click',
    category: 'BROWSER',
    name: 'Click Element',
    description: 'Click an element by selector',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'policy_authorized', reversible: 'UNKNOWN',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any selector' }],
    requiresHumanApproval: false, verificationRequirements: 'Element was clicked',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'browser.type',
    category: 'BROWSER',
    name: 'Type Text',
    description: 'Type text into an input element',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'policy_authorized', reversible: 'UNKNOWN',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any selector' }],
    requiresHumanApproval: false, verificationRequirements: 'Text was entered',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'browser.select',
    category: 'BROWSER',
    name: 'Select Option',
    description: 'Select an option from a dropdown',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'policy_authorized', reversible: 'UNKNOWN',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any selector' }],
    requiresHumanApproval: false, verificationRequirements: 'Option was selected',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'browser.submit_form',
    category: 'BROWSER',
    name: 'Submit Form',
    description: 'Submit a form on the page',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'EXTERNAL_COMMUNICATION',
    authorizationMode: 'human_required', reversible: 'UNKNOWN',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any form selector' }],
    requiresHumanApproval: true, verificationRequirements: 'Form submitted, response page loaded',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'browser.inspect_page',
    category: 'BROWSER',
    name: 'Inspect Page',
    description: 'Inspect the current page state (URL, title, elements)',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any page' }],
    requiresHumanApproval: false, verificationRequirements: 'Page state captured',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'browser.screenshot',
    category: 'BROWSER',
    name: 'Screenshot',
    description: 'Capture a screenshot of the current page',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any page' }],
    requiresHumanApproval: false, verificationRequirements: 'Screenshot captured',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'browser.upload_file',
    category: 'BROWSER',
    name: 'Upload File',
    description: 'Upload a file to a form on the page',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'EXTERNAL_COMMUNICATION',
    authorizationMode: 'human_required', reversible: 'UNKNOWN',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any upload input' }],
    requiresHumanApproval: true, verificationRequirements: 'File was uploaded',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'browser.download',
    category: 'BROWSER',
    name: 'Download File',
    description: 'Download a file from the browser',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'policy_authorized', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any download link' }],
    requiresHumanApproval: false, verificationRequirements: 'File downloaded successfully',
    timeoutMs: 60000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: FILE_EXISTS_VERIFY, adapterId: 'browser',
    lifecycleCapability: 'SUPPORTED',
  },
];

export const DEVELOPMENT_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'dev.git_status',
    category: 'DEVELOPMENT',
    name: 'Git Status',
    description: 'Check git repository status',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/.git', description: 'Git repositories' }],
    requiresHumanApproval: false, verificationRequirements: 'Git status output received',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'dev.git_branch',
    category: 'DEVELOPMENT',
    name: 'Git Branch',
    description: 'List or create git branches',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'policy_authorized', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/.git', description: 'Git repositories' }],
    requiresHumanApproval: false, verificationRequirements: 'Branch operation completed',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'dev.git_commit',
    category: 'DEVELOPMENT',
    name: 'Git Commit',
    description: 'Create a git commit',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'LOCAL_WRITE',
    authorizationMode: 'policy_authorized', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/.git', description: 'Git repositories' }],
    requiresHumanApproval: false, verificationRequirements: 'Commit created with expected message',
    timeoutMs: 15000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'dev.git_push',
    category: 'DEVELOPMENT',
    name: 'Git Push',
    description: 'Push commits to remote (HIGH RISK — affects shared state)',
    risk: 'R4', riskLabel: 'HIGH', authorizationScope: 'DEPLOYMENT',
    authorizationMode: 'human_required', reversible: 'IRREVERSIBLE',
    allowedTargets: [{ type: 'glob', pattern: '**/.git', description: 'Git repositories' }],
    requiresHumanApproval: true, verificationRequirements: 'Push completed, remote updated',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'dev.run_tests',
    category: 'DEVELOPMENT',
    name: 'Run Tests',
    description: 'Run the test suite',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Test commands' }],
    requiresHumanApproval: false, verificationRequirements: 'Tests executed, results captured',
    timeoutMs: 120000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'dev.build',
    category: 'DEVELOPMENT',
    name: 'Build Project',
    description: 'Build the project',
    risk: 'R1', riskLabel: 'LOW', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Build commands' }],
    requiresHumanApproval: false, verificationRequirements: 'Build completed successfully',
    timeoutMs: 120000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'dev.deploy',
    category: 'DEVELOPMENT',
    name: 'Deploy',
    description: 'Deploy to production (CRITICAL — affects live system)',
    risk: 'R4', riskLabel: 'CRITICAL', authorizationScope: 'DEPLOYMENT',
    authorizationMode: 'human_required', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Deployment targets' }],
    requiresHumanApproval: true, verificationRequirements: 'Deployment verified healthy',
    timeoutMs: 300000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'development',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
];

export const INFRASTRUCTURE_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'infra.docker_operation',
    category: 'INFRASTRUCTURE',
    name: 'Docker Operation',
    description: 'Perform a Docker operation (ps, logs, restart)',
    risk: 'R2', riskLabel: 'MEDIUM', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'policy_authorized', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Docker containers' }],
    requiresHumanApproval: false, verificationRequirements: 'Docker operation completed',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'infrastructure',
    lifecycleCapability: 'SUPPORTED',
  },
  {
    capabilityId: 'infra.service_restart',
    category: 'INFRASTRUCTURE',
    name: 'Service Restart',
    description: 'Restart a service (uses existing DependencyAwareRestartExecutor)',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'SERVICE_OPERATION',
    authorizationMode: 'human_required', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'module_id', pattern: '*', description: 'Allowlisted modules' }],
    requiresHumanApproval: true, verificationRequirements: 'Service is healthy after restart',
    timeoutMs: 60000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'infrastructure',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'infra.health_check',
    category: 'INFRASTRUCTURE',
    name: 'Health Check',
    description: 'Check the health of a service or endpoint',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any service/endpoint' }],
    requiresHumanApproval: false, verificationRequirements: 'Health status captured',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'infrastructure',
    lifecycleCapability: 'AUTOMATED',
  },
];

export const CREDENTIAL_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'credential.discover',
    category: 'CREDENTIALS',
    name: 'Discover Credentials',
    description: 'Discover credentials in the environment',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Environment' }],
    requiresHumanApproval: false, verificationRequirements: 'Discovery results captured',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'credential',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'credential.validate',
    category: 'CREDENTIALS',
    name: 'Validate Credential',
    description: 'Validate a credential against its provider',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Credential references' }],
    requiresHumanApproval: false, verificationRequirements: 'Provider validation result',
    timeoutMs: 15000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'credential',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'credential.provision',
    category: 'CREDENTIALS',
    name: 'Provision Credential',
    description: 'Provision a new credential through a provider API',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'CREDENTIAL_MANAGEMENT',
    authorizationMode: 'human_required', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Provider APIs' }],
    requiresHumanApproval: true, verificationRequirements: 'Credential validated after provisioning',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'credential',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'credential.rotate',
    category: 'CREDENTIALS',
    name: 'Rotate Credential',
    description: 'Rotate a credential (create replacement, validate, remove old)',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'CREDENTIAL_MANAGEMENT',
    authorizationMode: 'human_required', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Credential references' }],
    requiresHumanApproval: true, verificationRequirements: 'New credential validated, old revoked',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'credential',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'credential.revoke',
    category: 'CREDENTIALS',
    name: 'Revoke Credential',
    description: 'Revoke a credential (DESTRUCTIVE)',
    risk: 'R4', riskLabel: 'CRITICAL', authorizationScope: 'CREDENTIAL_MANAGEMENT',
    authorizationMode: 'human_required', reversible: 'IRREVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Credential references' }],
    requiresHumanApproval: true, verificationRequirements: 'Credential no longer valid',
    timeoutMs: 15000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'credential',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
];

export const COMMUNICATION_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'comm.prepare_email',
    category: 'COMMUNICATION',
    name: 'Prepare Email',
    description: 'Prepare an email draft (does not send)',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any recipient' }],
    requiresHumanApproval: false, verificationRequirements: 'Draft prepared',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'communication',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'comm.send_email',
    category: 'COMMUNICATION',
    name: 'Send Email',
    description: 'Send an email to a recipient (HIGH RISK — external communication)',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'EXTERNAL_COMMUNICATION',
    authorizationMode: 'human_required', reversible: 'IRREVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any recipient' }],
    requiresHumanApproval: true, verificationRequirements: 'Email sent, delivery confirmed',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'communication',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'comm.prepare_message',
    category: 'COMMUNICATION',
    name: 'Prepare Message',
    description: 'Prepare a message draft (does not send)',
    risk: 'R0', riskLabel: 'LOW', authorizationScope: 'READ_ONLY',
    authorizationMode: 'autonomous', reversible: 'REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any channel' }],
    requiresHumanApproval: false, verificationRequirements: 'Draft prepared',
    timeoutMs: 10000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'communication',
    lifecycleCapability: 'AUTOMATED',
  },
  {
    capabilityId: 'comm.send_message',
    category: 'COMMUNICATION',
    name: 'Send Message',
    description: 'Send a message to a channel (HIGH RISK — external communication)',
    risk: 'R3', riskLabel: 'HIGH', authorizationScope: 'EXTERNAL_COMMUNICATION',
    authorizationMode: 'human_required', reversible: 'IRREVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Any channel' }],
    requiresHumanApproval: true, verificationRequirements: 'Message sent',
    timeoutMs: 15000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'communication',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
];

export const FINANCIAL_CAPABILITIES: CapabilityDefinition[] = [
  {
    capabilityId: 'financial.create_charge',
    category: 'FINANCIAL',
    name: 'Create Charge',
    description: 'Create a financial charge (CRITICAL — real money)',
    risk: 'R5', riskLabel: 'CRITICAL', authorizationScope: 'FINANCIAL',
    authorizationMode: 'prohibited', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Payment providers' }],
    requiresHumanApproval: true, verificationRequirements: 'Charge verified through webhook',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'financial',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'financial.create_subscription',
    category: 'FINANCIAL',
    name: 'Create Subscription',
    description: 'Create a subscription (CRITICAL — recurring financial impact)',
    risk: 'R5', riskLabel: 'CRITICAL', authorizationScope: 'FINANCIAL',
    authorizationMode: 'prohibited', reversible: 'PARTIALLY_REVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Payment providers' }],
    requiresHumanApproval: true, verificationRequirements: 'Subscription verified',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: UNDO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'financial',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
  {
    capabilityId: 'financial.refund',
    category: 'FINANCIAL',
    name: 'Issue Refund',
    description: 'Issue a refund (CRITICAL — real money movement)',
    risk: 'R5', riskLabel: 'CRITICAL', authorizationScope: 'FINANCIAL',
    authorizationMode: 'prohibited', reversible: 'IRREVERSIBLE',
    allowedTargets: [{ type: 'any', pattern: '*', description: 'Payment providers' }],
    requiresHumanApproval: true, verificationRequirements: 'Refund verified',
    timeoutMs: 30000, retryPolicy: DEFAULT_RETRY, rollbackStrategyTemplate: NO_ROLLBACK,
    verificationStrategyTemplate: STATE_CHECK_VERIFY, adapterId: 'financial',
    lifecycleCapability: 'REQUIRES_AUTHORIZATION',
  },
];

/**
 * Bootstrap: register all default capabilities in a registry.
 */
export function createDefaultActionCapabilityRegistry(): ActionCapabilityRegistry {
  const registry = new ActionCapabilityRegistry();
  const all = [
    ...SYSTEM_CAPABILITIES,
    ...NETWORK_CAPABILITIES,
    ...BROWSER_CAPABILITIES,
    ...DEVELOPMENT_CAPABILITIES,
    ...INFRASTRUCTURE_CAPABILITIES,
    ...CREDENTIAL_CAPABILITIES,
    ...COMMUNICATION_CAPABILITIES,
    ...FINANCIAL_CAPABILITIES,
  ];
  for (const def of all) {
    const { capabilityId: _id, ...rest } = def;
    void _id;
    registry.register({ capabilityId: def.capabilityId, ...rest });
  }
  return registry;
}
