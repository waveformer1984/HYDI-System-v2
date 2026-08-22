/**
 * HYDI Verification Contracts
 *
 * Every capability must define:
 *   ACTION
 *   EXPECTED STATE
 *   OBSERVATION
 *   VERIFICATION
 *   FAILURE CLASSIFICATION
 *
 * A successful action (HTTP 201, exit code 0) is NOT proof of success.
 * The verification contract defines what "success" actually means.
 */

import type { RiskLevel } from '../operational/types';

// ---------------------------------------------------------------------------
// Verification Contract
// ---------------------------------------------------------------------------

/**
 * A verification contract for a capability.
 *
 * Defines what evidence is required to prove the action achieved its
 * intended outcome — not just that it didn't throw.
 */
export interface VerificationContract {
  /** The capability this contract applies to */
  capability: string;
  /** What the action does (human-readable) */
  actionDescription: string;
  /** The expected state after successful execution */
  expectedState: ExpectedState;
  /** How to observe the resulting state */
  observation: ObservationSpec;
  /** The verification predicate — what must be true for success */
  verification: VerificationPredicate;
  /** How to classify failures */
  failureClassification: FailureClassificationSpec;
  /** The risk level of the action */
  riskLevel: RiskLevel;
}

/**
 * The expected state after a successful action.
 */
export interface ExpectedState {
  /** Human-readable description of the expected state */
  description: string;
  /** Required conditions that must be true */
  conditions: ExpectedCondition[];
}

export interface ExpectedCondition {
  /** What to check */
  field: string;
  /** The expected value or pattern */
  expected: string | number | boolean | null;
  /** How to compare */
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'matches' | 'exists' | 'not_null';
}

/**
 * How to observe the resulting state.
 */
export interface ObservationSpec {
  /** What to observe (e.g. "api_response", "filesystem", "process", "browser") */
  source: string;
  /** The target to observe (e.g. URL, path, process name) */
  target: string;
  /** What fields to extract from the observation */
  extractFields: string[];
}

/**
 * The verification predicate.
 */
export interface VerificationPredicate {
  /** Human-readable description of what must be true */
  description: string;
  /** The conditions that must ALL be true for verification to pass */
  conditions: ExpectedCondition[];
  /** What to do if verification fails */
  onFailure: 'retry' | 'replan' | 'escalate' | 'rollback' | 'fail';
  /** Maximum verification retries before escalation */
  maxRetries: number;
}

/**
 * How to classify failures for this capability.
 */
export interface FailureClassificationSpec {
  /** Failure patterns and their classifications */
  patterns: FailurePattern[];
}

export interface FailurePattern {
  /** What the failure looks like */
  pattern: string;
  /** The classification */
  classification: 'TRANSIENT' | 'PERMANENT' | 'AUTHORIZATION' | 'RESOURCE' | 'POLICY' | 'UNKNOWN';
  /** Whether to retry */
  retryable: boolean;
  /** Human-readable reason */
  reason: string;
}

// ---------------------------------------------------------------------------
// Verification Result
// ---------------------------------------------------------------------------

export interface VerificationResult {
  /** Whether verification passed */
  verified: boolean;
  /** Confidence level (0-1) */
  confidence: number;
  /** Evidence supporting the result */
  evidence: string;
  /** Which conditions failed (if any) */
  failedConditions: string[];
  /** The observation used for verification */
  observedState: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Verification Contract Registry
// ---------------------------------------------------------------------------

/**
 * Registry of verification contracts per capability.
 */
export class VerificationContractRegistry {
  private contracts = new Map<string, VerificationContract>();

  /**
   * Register a verification contract.
   */
  register(contract: VerificationContract): void {
    this.contracts.set(contract.capability, contract);
  }

  /**
   * Get the verification contract for a capability.
   */
  get(capability: string): VerificationContract | null {
    return this.contracts.get(capability) ?? null;
  }

  /**
   * Verify an action result against its contract.
   */
  verify(capability: string, observedState: Record<string, unknown>): VerificationResult {
    const contract = this.contracts.get(capability);
    if (!contract) {
      return {
        verified: true, // No contract = trust the adapter
        confidence: 0.5,
        evidence: 'No verification contract registered — trusting adapter result',
        failedConditions: [],
        observedState,
      };
    }

    const failedConditions: string[] = [];
    for (const condition of contract.verification.conditions) {
      const fieldValue = this.extractField(observedState, condition.field);
      if (!this.checkCondition(fieldValue, condition)) {
        failedConditions.push(
          `${condition.field} ${condition.operator} ${condition.expected} (got: ${fieldValue})`,
        );
      }
    }

    const verified = failedConditions.length === 0;
    return {
      verified,
      confidence: verified ? 0.95 : 0.3,
      evidence: verified
        ? `All ${contract.verification.conditions.length} verification conditions passed`
        : `Failed conditions: ${failedConditions.join(', ')}`,
      failedConditions,
      observedState,
    };
  }

  /**
   * Extract a field from an observed state object.
   * Supports dot notation (e.g. "body.entryCount").
   */
  private extractField(state: Record<string, unknown>, field: string): unknown {
    const parts = field.split('.');
    let current: unknown = state;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /**
   * Check a condition against a field value.
   */
  private checkCondition(value: unknown, condition: ExpectedCondition): boolean {
    switch (condition.operator) {
      case 'eq': return value === condition.expected;
      case 'neq': return value !== condition.expected;
      case 'gt': return typeof value === 'number' && typeof condition.expected === 'number' && value > condition.expected;
      case 'lt': return typeof value === 'number' && typeof condition.expected === 'number' && value < condition.expected;
      case 'gte': return typeof value === 'number' && typeof condition.expected === 'number' && value >= condition.expected;
      case 'lte': return typeof value === 'number' && typeof condition.expected === 'number' && value <= condition.expected;
      case 'contains': return typeof value === 'string' && typeof condition.expected === 'string' && value.includes(condition.expected);
      case 'matches': return typeof value === 'string' && typeof condition.expected === 'string' && new RegExp(condition.expected).test(value);
      case 'exists': return value !== undefined && value !== null;
      case 'not_null': return value !== null;
      default: return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Default Verification Contracts
// ---------------------------------------------------------------------------

/**
 * Create default verification contracts for all registered capabilities.
 */
export function createDefaultVerificationContracts(): VerificationContract[] {
  return [
    // Filesystem
    {
      capability: 'filesystem.write_file',
      actionDescription: 'Write content to a file',
      expectedState: {
        description: 'File exists and contains the written content',
        conditions: [
          { field: 'exists', expected: true, operator: 'eq' },
          { field: 'size', expected: 0, operator: 'gt' },
        ],
      },
      observation: { source: 'filesystem', target: '{target}', extractFields: ['exists', 'size', 'modifiedAt'] },
      verification: {
        description: 'File exists with non-zero size after write',
        conditions: [
          { field: 'exists', expected: true, operator: 'eq' },
          { field: 'size', expected: 0, operator: 'gt' },
        ],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: {
        patterns: [
          { pattern: 'ENOENT', classification: 'PERMANENT', retryable: false, reason: 'Directory does not exist' },
          { pattern: 'EACCES', classification: 'AUTHORIZATION', retryable: false, reason: 'Permission denied' },
          { pattern: 'ENOSPC', classification: 'RESOURCE', retryable: false, reason: 'Disk full' },
        ],
      },
      riskLevel: 'R1',
    },
    {
      capability: 'filesystem.create_directory',
      actionDescription: 'Create a directory',
      expectedState: {
        description: 'Directory exists',
        conditions: [{ field: 'exists', expected: true, operator: 'eq' }, { field: 'isDirectory', expected: true, operator: 'eq' }],
      },
      observation: { source: 'filesystem', target: '{target}', extractFields: ['exists', 'isDirectory'] },
      verification: {
        description: 'Directory exists and is a directory',
        conditions: [{ field: 'exists', expected: true, operator: 'eq' }, { field: 'isDirectory', expected: true, operator: 'eq' }],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R0',
    },
    {
      capability: 'filesystem.delete_file',
      actionDescription: 'Delete a file or directory',
      expectedState: { description: 'File no longer exists', conditions: [{ field: 'exists', expected: false, operator: 'eq' }] },
      observation: { source: 'filesystem', target: '{target}', extractFields: ['exists'] },
      verification: {
        description: 'File does not exist after deletion',
        conditions: [{ field: 'exists', expected: false, operator: 'eq' }],
        onFailure: 'escalate',
        maxRetries: 1,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R3',
    },

    // Process
    {
      capability: 'process.start',
      actionDescription: 'Start a process',
      expectedState: { description: 'Process is running', conditions: [{ field: 'running', expected: true, operator: 'eq' }] },
      observation: { source: 'process', target: '{target}', extractFields: ['running', 'pid'] },
      verification: {
        description: 'Process is running with a PID',
        conditions: [{ field: 'running', expected: true, operator: 'eq' }, { field: 'pid', expected: null, operator: 'not_null' }],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R2',
    },

    // Network
    {
      capability: 'network.http_request',
      actionDescription: 'Make an HTTP request',
      expectedState: {
        description: 'HTTP response with expected status code',
        conditions: [{ field: 'statusCode', expected: 200, operator: 'gte' }, { field: 'statusCode', expected: 300, operator: 'lt' }],
      },
      observation: { source: 'api', target: '{target}', extractFields: ['statusCode', 'body'] },
      verification: {
        description: 'HTTP 2xx response received',
        conditions: [{ field: 'statusCode', expected: 200, operator: 'gte' }, { field: 'statusCode', expected: 300, operator: 'lt' }],
        onFailure: 'replan',
        maxRetries: 2,
      },
      failureClassification: {
        patterns: [
          { pattern: '429', classification: 'TRANSIENT', retryable: true, reason: 'Rate limited' },
          { pattern: '401', classification: 'AUTHORIZATION', retryable: false, reason: 'Unauthorized' },
          { pattern: '403', classification: 'AUTHORIZATION', retryable: false, reason: 'Forbidden' },
          { pattern: '404', classification: 'PERMANENT', retryable: false, reason: 'Not found' },
          { pattern: '500', classification: 'TRANSIENT', retryable: true, reason: 'Server error' },
          { pattern: 'timeout', classification: 'TRANSIENT', retryable: true, reason: 'Request timeout' },
        ],
      },
      riskLevel: 'R1',
    },

    // Browser
    {
      capability: 'browser.navigate',
      actionDescription: 'Navigate to a URL',
      expectedState: { description: 'Browser is on the target page', conditions: [{ field: 'url', expected: '{target}', operator: 'contains' }] },
      observation: { source: 'browser', target: '{target}', extractFields: ['url', 'title'] },
      verification: {
        description: 'Browser URL matches target',
        conditions: [{ field: 'url', expected: '{target}', operator: 'contains' }],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: {
        patterns: [
          { pattern: 'net::ERR', classification: 'TRANSIENT', retryable: true, reason: 'Network error' },
          { pattern: 'timeout', classification: 'TRANSIENT', retryable: true, reason: 'Navigation timeout' },
        ],
      },
      riskLevel: 'R1',
    },
    {
      capability: 'browser.click',
      actionDescription: 'Click an element',
      expectedState: { description: 'Element was clicked and page state changed', conditions: [{ field: 'clicked', expected: true, operator: 'eq' }] },
      observation: { source: 'browser', target: '{target}', extractFields: ['url', 'clicked'] },
      verification: {
        description: 'Click was performed and expected state change occurred',
        conditions: [{ field: 'clicked', expected: true, operator: 'eq' }],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R2',
    },
    {
      capability: 'browser.submit_form',
      actionDescription: 'Submit a form',
      expectedState: { description: 'Form submitted, page navigated or success indicator appeared', conditions: [{ field: 'navigated', expected: true, operator: 'eq' }] },
      observation: { source: 'browser', target: '{target}', extractFields: ['url', 'navigated', 'successIndicator'] },
      verification: {
        description: 'Form submission caused navigation or success indicator',
        conditions: [
          { field: 'navigated', expected: true, operator: 'eq' },
        ],
        onFailure: 'escalate',
        maxRetries: 1,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R3',
    },

    // Development
    {
      capability: 'dev.git_commit',
      actionDescription: 'Create a git commit',
      expectedState: { description: 'Commit was created', conditions: [{ field: 'committed', expected: true, operator: 'eq' }] },
      observation: { source: 'git', target: '{target}', extractFields: ['committed', 'commitHash'] },
      verification: {
        description: 'Commit hash exists and working tree is clean',
        conditions: [{ field: 'committed', expected: true, operator: 'eq' }, { field: 'commitHash', expected: null, operator: 'not_null' }],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R2',
    },
    {
      capability: 'dev.run_tests',
      actionDescription: 'Run tests',
      expectedState: { description: 'Tests passed', conditions: [{ field: 'passed', expected: true, operator: 'eq' }, { field: 'failedCount', expected: 0, operator: 'eq' }] },
      observation: { source: 'process', target: '{target}', extractFields: ['exitCode', 'stdout', 'passed', 'failedCount'] },
      verification: {
        description: 'Exit code 0 and no failed tests',
        conditions: [{ field: 'exitCode', expected: 0, operator: 'eq' }, { field: 'failedCount', expected: 0, operator: 'eq' }],
        onFailure: 'fail',
        maxRetries: 0,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R1',
    },
    {
      capability: 'dev.build',
      actionDescription: 'Build the project',
      expectedState: { description: 'Build succeeded', conditions: [{ field: 'exitCode', expected: 0, operator: 'eq' }] },
      observation: { source: 'process', target: '{target}', extractFields: ['exitCode', 'stdout', 'stderr'] },
      verification: {
        description: 'Build exit code 0',
        conditions: [{ field: 'exitCode', expected: 0, operator: 'eq' }],
        onFailure: 'fail',
        maxRetries: 0,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R1',
    },

    // Infrastructure
    {
      capability: 'infra.health_check',
      actionDescription: 'Check service health',
      expectedState: { description: 'Service is healthy', conditions: [{ field: 'healthy', expected: true, operator: 'eq' }] },
      observation: { source: 'health', target: '{target}', extractFields: ['healthy', 'statusCode'] },
      verification: {
        description: 'Health endpoint returns healthy status',
        conditions: [{ field: 'healthy', expected: true, operator: 'eq' }],
        onFailure: 'replan',
        maxRetries: 3,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R0',
    },

    // Credentials
    {
      capability: 'credential.validate',
      actionDescription: 'Validate a credential',
      expectedState: { description: 'Credential is valid', conditions: [{ field: 'valid', expected: true, operator: 'eq' }] },
      observation: { source: 'credential', target: '{target}', extractFields: ['valid', 'status'] },
      verification: {
        description: 'Credential validation returned valid=true',
        conditions: [{ field: 'valid', expected: true, operator: 'eq' }],
        onFailure: 'escalate',
        maxRetries: 1,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R0',
    },

    // Communication
    {
      capability: 'comm.send_email',
      actionDescription: 'Send an email',
      expectedState: { description: 'Email was accepted by provider', conditions: [{ field: 'accepted', expected: true, operator: 'eq' }, { field: 'messageId', expected: null, operator: 'not_null' }] },
      observation: { source: 'api', target: '{target}', extractFields: ['accepted', 'messageId'] },
      verification: {
        description: 'Provider accepted message and returned a message ID',
        conditions: [{ field: 'accepted', expected: true, operator: 'eq' }, { field: 'messageId', expected: null, operator: 'not_null' }],
        onFailure: 'retry',
        maxRetries: 2,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R3',
    },

    // Revenue — keyed as 'revenue.ledger_query' to not overwrite the generic HTTP contract
    {
      capability: 'revenue.ledger_query',
      actionDescription: 'Query revenue ledger',
      expectedState: { description: 'Revenue ledger entries are provider-verified', conditions: [{ field: 'body.entryCount', expected: 0, operator: 'gt' }, { field: 'body.unverifiedCount', expected: 0, operator: 'eq' }] },
      observation: { source: 'api', target: '{target}', extractFields: ['statusCode', 'body'] },
      verification: {
        description: 'Ledger has entries and all are verified',
        conditions: [{ field: 'body.entryCount', expected: 0, operator: 'gt' }, { field: 'body.unverifiedCount', expected: 0, operator: 'eq' }],
        onFailure: 'escalate',
        maxRetries: 1,
      },
      failureClassification: { patterns: [] },
      riskLevel: 'R0',
    },
  ];
}
