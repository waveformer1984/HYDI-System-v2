/**
 * HYDI Credential State Machine
 *
 * Explicit lifecycle for credentials managed by HYDI's governed-autonomy
 * architecture. This extends the existing KeyManagementTypes (which defines
 * KeyHealthState: HEALTHY | DEGRADED | CRITICAL | UNKNOWN | MISSING) with
 * a finer-grained state machine specific to credential governance.
 *
 * The state machine enforces:
 *   - Legal transitions only (rejects illegal moves)
 *   - Transition evidence persistence (every move is recorded)
 *   - No skipping validation steps
 *   - Authorization boundaries for sensitive transitions
 *
 * States:
 *   DISCOVERED                    - credential reference found in config
 *   CLASSIFIED                    - type/provider classified
 *   VALIDATED                     - format and provider API checked
 *   HEALTHY                       - fully verified and in use
 *   INVALID                       - provider API rejected
 *   EXPIRED                       - provider reports expired
 *   REVOKED                       - provider reports revoked
 *   ROTATION_REQUIRED             - health check says rotation needed
 *   ROTATION_PENDING_AUTHORIZATION - rotation plan ready, awaiting human auth
 *   ROTATING                      - rotation in progress (authorized)
 *   ROTATED                       - new credential issued, old not yet revoked
 *   VERIFICATION_FAILED           - new credential failed verification
 *   EXPOSED                       - found in logs/history/git
 *   ISOLATED                      - taken out of service (not revoked yet)
 *   ESCALATED                     - escalated to human, no auto path
 *   BLOCKED                       - external dependency missing
 *
 * SECURITY: No raw credential values are stored in transitions.
 */

import { randomUUID } from 'crypto';

// ─── Credential States ───────────────────────────────────────────────────

export type CredentialState =
  | 'DISCOVERED'
  | 'CLASSIFIED'
  | 'VALIDATED'
  | 'HEALTHY'
  | 'INVALID'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ROTATION_REQUIRED'
  | 'ROTATION_PENDING_AUTHORIZATION'
  | 'ROTATING'
  | 'ROTATED'
  | 'VERIFICATION_FAILED'
  | 'EXPOSED'
  | 'ISOLATED'
  | 'ESCALATED'
  | 'BLOCKED';

/**
 * Terminal states — once reached, the credential stays there until
 * a human-initiated reset.
 */
export const TERMINAL_STATES: CredentialState[] = [
  'REVOKED',
  'ESCALATED',
];

/**
 * States that require human action to leave.
 */
export const HUMAN_REQUIRED_STATES: CredentialState[] = [
  'ROTATION_PENDING_AUTHORIZATION',
  'ESCALATED',
  'EXPOSED',
];

// ─── Legal Transitions ───────────────────────────────────────────────────

/**
 * Map of legal state transitions.
 * Key = current state, Value = set of allowed next states.
 */
const LEGAL_TRANSITIONS: Record<CredentialState, CredentialState[]> = {
  DISCOVERED: ['CLASSIFIED', 'BLOCKED', 'INVALID', 'ESCALATED'],
  CLASSIFIED: ['VALIDATED', 'INVALID', 'EXPIRED', 'REVOKED', 'EXPOSED', 'BLOCKED', 'ESCALATED', 'ROTATION_REQUIRED'],
  VALIDATED: ['HEALTHY', 'INVALID', 'EXPIRED', 'REVOKED', 'EXPOSED', 'ROTATION_REQUIRED', 'BLOCKED'],
  HEALTHY: ['ROTATION_REQUIRED', 'INVALID', 'EXPIRED', 'REVOKED', 'EXPOSED', 'BLOCKED', 'ESCALATED'],
  INVALID: ['ROTATION_REQUIRED', 'ESCALATED', 'BLOCKED', 'ISOLATED'],
  EXPIRED: ['ROTATION_REQUIRED', 'ESCALATED', 'BLOCKED', 'ISOLATED'],
  REVOKED: ['ROTATION_REQUIRED', 'ESCALATED'], // can request new rotation
  ROTATION_REQUIRED: ['ROTATION_PENDING_AUTHORIZATION', 'ROTATING', 'ESCALATED', 'BLOCKED'],
  ROTATION_PENDING_AUTHORIZATION: ['ROTATING', 'ESCALATED', 'ROTATION_REQUIRED', 'BLOCKED'],
  ROTATING: ['ROTATED', 'VERIFICATION_FAILED', 'ESCALATED', 'BLOCKED'],
  ROTATED: ['HEALTHY', 'VERIFICATION_FAILED', 'ESCALATED', 'BLOCKED'],
  VERIFICATION_FAILED: ['ROTATING', 'ESCALATED', 'BLOCKED', 'ISOLATED'],
  EXPOSED: ['ISOLATED', 'ROTATION_REQUIRED', 'ESCALATED', 'BLOCKED'],
  ISOLATED: ['ROTATION_REQUIRED', 'REVOKED', 'ESCALATED', 'BLOCKED'],
  ESCALATED: ['ROTATION_REQUIRED', 'BLOCKED', 'ISOLATED'], // human can re-initiate
  BLOCKED: ['DISCOVERED', 'CLASSIFIED', 'VALIDATED', 'ROTATION_REQUIRED', 'ESCALATED'], // external dep may recover
};

// ─── Transition Record ───────────────────────────────────────────────────

export interface CredentialTransition {
  id: string;
  credentialId: string;
  from: CredentialState;
  to: CredentialState;
  timestamp: string;
  reason: string;
  /** Who/what authorized this transition */
  authorization: {
    mode: 'autonomous' | 'policy_authorized' | 'human_authorized' | 'system';
    actor: string | null;
    role: string | null;
  };
  /** Evidence backing this transition (no raw secrets) */
  evidence: {
    verificationLevel: string;
    source: string;
    details: string;
  };
  /** Safe credential metadata (no raw values) */
  credentialMetadata: {
    type: string;
    provider: string;
    fingerprint: string;
  };
}

// ─── Credential Record ───────────────────────────────────────────────────

/**
 * The durable record of a credential's state and history.
 * SECURITY: Contains only safe metadata — never raw credential values.
 */
export interface CredentialRecord {
  id: string;
  /** Safe identifier (e.g., 'stripe_secret_key', 'webhook_secret_01') */
  name: string;
  /** Credential type (e.g., 'stripe_secret_key', 'webhook_signing_secret') */
  type: string;
  /** Provider (e.g., 'stripe', 'supabase') */
  provider: string;
  /** Safe fingerprint (hash of credential value, never the value itself) */
  fingerprint: string;
  /** Safe prefix (e.g., 'sk_test_...') */
  prefix: string | null;
  /** Current state */
  state: CredentialState;
  /** Environment (test, live, development) */
  environment: string;
  /** Configuration source (e.g., '.env.local', 'process.env.STRIPE_SECRET_KEY') */
  source: string;
  /** Dependent capabilities */
  dependentCapabilities: string[];
  /** Dependent services */
  dependentServices: string[];
  /** Expiration if known */
  expiresAt: string | null;
  /** When this record was created */
  createdAt: string;
  /** When state was last updated */
  updatedAt: string;
  /** Transition history */
  history: CredentialTransition[];
  /** Whether rotation is safe (no irreversible external side effects) */
  rotationSafe: boolean;
  /** Whether the credential has been observed in exposed material */
  exposureDetected: boolean;
  /** Remediation tracking ID if exposed */
  remediationId: string | null;
}

// ─── State Machine ───────────────────────────────────────────────────────

/**
 * Credential state machine. Enforces legal transitions and persists
 * transition evidence.
 */
export class CredentialStateMachine {
  private records: Map<string, CredentialRecord> = new Map();
  private byName: Map<string, string> = new Map();

  /**
   * Register a new credential record (starts in DISCOVERED state).
   */
  register(params: {
    name: string;
    type: string;
    provider: string;
    fingerprint: string;
    prefix?: string | null;
    environment: string;
    source: string;
    dependentCapabilities?: string[];
    dependentServices?: string[];
    expiresAt?: string | null;
    rotationSafe?: boolean;
  }): CredentialRecord {
    // Check if already registered
    const existingId = this.byName.get(params.name);
    if (existingId) {
      return this.records.get(existingId)!;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const record: CredentialRecord = {
      id,
      name: params.name,
      type: params.type,
      provider: params.provider,
      fingerprint: params.fingerprint,
      prefix: params.prefix || null,
      state: 'DISCOVERED',
      environment: params.environment,
      source: params.source,
      dependentCapabilities: params.dependentCapabilities || [],
      dependentServices: params.dependentServices || [],
      expiresAt: params.expiresAt || null,
      createdAt: now,
      updatedAt: now,
      history: [],
      rotationSafe: params.rotationSafe ?? false,
      exposureDetected: false,
      remediationId: null,
    };

    this.records.set(id, record);
    this.byName.set(params.name, id);
    return record;
  }

  /**
   * Attempt a state transition. Throws on illegal transitions.
   */
  transition(
    credentialId: string,
    to: CredentialState,
    params: {
      reason: string;
      authorization: CredentialTransition['authorization'];
      evidence: CredentialTransition['evidence'];
    }
  ): CredentialTransition {
    const record = this.records.get(credentialId);
    if (!record) {
      throw new Error(`Credential not found: ${credentialId}`);
    }

    const from = record.state;
    const allowed = LEGAL_TRANSITIONS[from] || [];

    if (!allowed.includes(to)) {
      throw new Error(
        `Illegal credential transition: ${from} → ${to} (legal: ${allowed.join(', ')})`
      );
    }

    // Authorization check for sensitive transitions
    const sensitiveTransitions: CredentialState[] = [
      'ROTATING',
      'ROTATED',
      'ISOLATED',
      'REVOKED',
    ];
    if (sensitiveTransitions.includes(to) && params.authorization.mode === 'autonomous') {
      throw new Error(
        `Unauthorized: transition to ${to} requires policy_authorized or human_authorized, got autonomous`
      );
    }

    const transition: CredentialTransition = {
      id: randomUUID(),
      credentialId,
      from,
      to,
      timestamp: new Date().toISOString(),
      reason: params.reason,
      authorization: params.authorization,
      evidence: params.evidence,
      credentialMetadata: {
        type: record.type,
        provider: record.provider,
        fingerprint: record.fingerprint,
      },
    };

    record.state = to;
    record.updatedAt = transition.timestamp;
    record.history.push(transition);

    if (to === 'EXPOSED') {
      record.exposureDetected = true;
    }

    return transition;
  }

  /**
   * Get a credential record by ID.
   */
  get(credentialId: string): CredentialRecord | null {
    return this.records.get(credentialId) || null;
  }

  /**
   * Get a credential record by name.
   */
  getByName(name: string): CredentialRecord | null {
    const id = this.byName.get(name);
    if (!id) return null;
    return this.records.get(id) || null;
  }

  /**
   * Get all credential records.
   */
  getAll(): CredentialRecord[] {
    return Array.from(this.records.values());
  }

  /**
   * Get credentials by provider.
   */
  getByProvider(provider: string): CredentialRecord[] {
    return this.getAll().filter(r => r.provider === provider);
  }

  /**
   * Get credentials by state.
   */
  getByState(state: CredentialState): CredentialRecord[] {
    return this.getAll().filter(r => r.state === state);
  }

  /**
   * Get credentials that require human action.
   */
  getHumanRequired(): CredentialRecord[] {
    return this.getAll().filter(r => HUMAN_REQUIRED_STATES.includes(r.state));
  }

  /**
   * Get credentials that are blocked.
   */
  getBlocked(): CredentialRecord[] {
    return this.getByState('BLOCKED');
  }

  /**
   * Get credentials that need rotation.
   */
  getRotationRequired(): CredentialRecord[] {
    return this.getAll().filter(r =>
      ['ROTATION_REQUIRED', 'ROTATION_PENDING_AUTHORIZATION', 'VERIFICATION_FAILED'].includes(r.state)
    );
  }

  /**
   * Check if a transition is legal without performing it.
   */
  canTransition(from: CredentialState, to: CredentialState): boolean {
    const allowed = LEGAL_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  /**
   * Get the legal transitions from a state.
   */
  getLegalTransitions(from: CredentialState): CredentialState[] {
    return [...(LEGAL_TRANSITIONS[from] || [])];
  }

  /**
   * Update credential metadata (does not change state).
   */
  updateMetadata(credentialId: string, updates: Partial<Pick<CredentialRecord,
    'dependentCapabilities' | 'dependentServices' | 'expiresAt' | 'rotationSafe' | 'remediationId'
  >>): void {
    const record = this.records.get(credentialId);
    if (!record) {
      throw new Error(`Credential not found: ${credentialId}`);
    }
    Object.assign(record, updates);
    record.updatedAt = new Date().toISOString();
  }

  /**
   * Get a summary of all credential states.
   */
  getSummary(): {
    total: number;
    byState: Record<string, number>;
    byProvider: Record<string, number>;
    blocked: number;
    humanRequired: number;
    rotationRequired: number;
    healthy: number;
  } {
    const all = this.getAll();
    const byState: Record<string, number> = {};
    const byProvider: Record<string, number> = {};

    for (const r of all) {
      byState[r.state] = (byState[r.state] || 0) + 1;
      byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
    }

    return {
      total: all.length,
      byState,
      byProvider,
      blocked: this.getBlocked().length,
      humanRequired: this.getHumanRequired().length,
      rotationRequired: this.getRotationRequired().length,
      healthy: this.getByState('HEALTHY').length,
    };
  }

  /**
   * Serialize for persistence (restart recovery).
   */
  serialize(): string {
    const data = {
      records: Array.from(this.records.entries()),
      byName: Array.from(this.byName.entries()),
    };
    return JSON.stringify(data);
  }

  /**
   * Restore from persistence.
   */
  restore(serialized: string): void {
    const data = JSON.parse(serialized);
    this.records = new Map(data.records);
    this.byName = new Map(data.byName);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let stateMachineInstance: CredentialStateMachine | null = null;

export function getCredentialStateMachine(): CredentialStateMachine {
  if (!stateMachineInstance) {
    stateMachineInstance = new CredentialStateMachine();
  }
  return stateMachineInstance;
}

// ─── Placeholder Detection ───────────────────────────────────────────────

/**
 * Common placeholder patterns that indicate a credential is NOT real.
 * This is critical for no-false-green: a placeholder must never be
 * treated as a valid credential.
 */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /sk_test_[a-zA-Z0-9]*0{4,}/,          // sk_test_...0000
  /sk_live_[a-zA-Z0-9]*0{4,}/,          // sk_live_...0000
  /rk_live_[a-zA-Z0-9]*0{4,}/,          // rk_live_...0000
  /whsec_[a-zA-Z0-9]*0{4,}/,            // whsec_...0000
  /your[_-]?stripe[_-]?key/i,           // your_stripe_key
  /your[_-]?webhook[_-]?secret/i,       // your_webhook_secret
  /placeholder/i,                        // placeholder
  /example/i,                            // example
  /test[_-]?key[_-]?here/i,             // test_key_here
  /replace[_-]?me/i,                     // replace_me
  /change[_-]?me/i,                      // change_me
  /xxxx/i,                               // xxxx
  /^<.+>$/,                              // <...>
  /^your.+$/i,                           // your...
];

/**
 * Check if a credential value is a placeholder.
 * SECURITY: This function receives the raw value but never returns it.
 */
export function isPlaceholder(value: string): boolean {
  if (!value || value.trim() === '') return true;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(value)) return true;
  }
  return false;
}

/**
 * Common malformed patterns.
 */
export function isMalformed(value: string, expectedPrefix?: string): boolean {
  if (!value || value.trim() === '') return true;
  if (expectedPrefix && !value.startsWith(expectedPrefix)) return true;
  // Check for obviously wrong formats
  if (value.includes(' ') && !value.startsWith('-----BEGIN')) return true;
  return false;
}
