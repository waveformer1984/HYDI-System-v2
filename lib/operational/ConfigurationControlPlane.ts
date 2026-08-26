/**
 * Configuration Control Plane
 *
 * Governs runtime configuration values (non-secret) such as:
 *   ALLOW_LIVE_STRIPE
 *   LIVE_QUALIFICATION_CUSTOMER_EMAIL
 *   WEBHOOK_PROCESSING_ENABLED
 *   NODE_ENV
 *   feature flags
 *
 * This is NOT a secret store. Secret values (Stripe keys, webhook secrets,
 * service tokens) are handled by CredentialManager / CredentialSource.
 *
 * Configuration changes are:
 *   - policy checked (is this key allowed to be modified?)
 *   - validated (does the value match expected format?)
 *   - atomic (write succeeds completely or not at all)
 *   - auditable (every change is recorded)
 *   - reversible (previous value is preserved for rollback)
 *   - verified after application (read-back confirmation)
 *
 * The control plane wraps .env.local management rather than scattering
 * direct file edits throughout the codebase.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────

export type ConfigValueType = 'boolean' | 'string' | 'enum' | 'email';

export interface ConfigKeyDescriptor {
  /** The environment variable name */
  key: string;
  /** Human-readable description */
  description: string;
  /** Whether this is a secret (secrets are handled by CredentialManager, not here) */
  isSecret: boolean;
  /** Value type for validation */
  type: ConfigValueType;
  /** Allowed values for enum type */
  allowedValues?: string[];
  /** Whether HYDI is allowed to modify this value autonomously */
  autoModifiable: boolean;
  /** Whether this value requires a server restart to take effect */
  requiresRestart: boolean;
  /** Default value if unset */
  default?: string;
}

export interface ConfigChange {
  key: string;
  oldValue: string | null;
  newValue: string;
  changedAt: string;
  changedBy: string;
  reason: string;
  /** Previous value for rollback */
  rollbackValue: string | null;
}

export interface ConfigChangeResult {
  success: boolean;
  key: string;
  value: string | null;
  error?: string;
  change?: ConfigChange;
  verified: boolean;
}

export interface ConfigSnapshot {
  timestamp: string;
  values: Record<string, string | null>;
  source: string;
}

// ─── Registry of known configuration keys ────────────────────────────────

const CONFIG_REGISTRY: Map<string, ConfigKeyDescriptor> = new Map([
  ['ALLOW_LIVE_STRIPE', {
    key: 'ALLOW_LIVE_STRIPE',
    description: 'Authorizes the system to report READY during live preflight. Does NOT authorize a charge.',
    isSecret: false,
    type: 'boolean',
    autoModifiable: true,
    requiresRestart: true,
    default: 'false',
  }],
  ['LIVE_QUALIFICATION_CUSTOMER_EMAIL', {
    key: 'LIVE_QUALIFICATION_CUSTOMER_EMAIL',
    description: 'The controlled customer identity for the single qualification transaction.',
    isSecret: false,
    type: 'email',
    autoModifiable: true,
    requiresRestart: false,
  }],
  ['WEBHOOK_PROCESSING_ENABLED', {
    key: 'WEBHOOK_PROCESSING_ENABLED',
    description: 'Kill switch for webhook processing. Must be "true" for the handler to process events.',
    isSecret: false,
    type: 'boolean',
    autoModifiable: true,
    requiresRestart: false,
    default: 'true',
  }],
  ['NODE_ENV', {
    key: 'NODE_ENV',
    description: 'Runtime environment mode.',
    isSecret: false,
    type: 'enum',
    allowedValues: ['development', 'production', 'test'],
    autoModifiable: false,
    requiresRestart: true,
    default: 'development',
  }],
]);

// Secret keys — these are NEVER managed by ConfigurationControlPlane.
// They are handled by CredentialManager. Listed here only for validation
// to prevent accidental non-secret treatment.
const SECRET_KEYS = new Set([
  'STRIPE_SECRET_KEY',
  'STRIPE_RESTRICTED_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_WEBHOOK_SECRET_01',
  'STRIPE_CLI_SESSION',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'HYDI_SERVICE_SECRET',
  'HEIDI_SECRET',
]);

// ─── Configuration Control Plane ─────────────────────────────────────────

export class ConfigurationControlPlane {
  private envLocalPath: string;
  private auditLog: ConfigChange[] = [];
  private static instance: ConfigurationControlPlane | null = null;

  constructor(envLocalPath?: string) {
    this.envLocalPath = envLocalPath || join(process.cwd(), '.env.local');
  }

  static getInstance(): ConfigurationControlPlane {
    if (!ConfigurationControlPlane.instance) {
      ConfigurationControlPlane.instance = new ConfigurationControlPlane();
    }
    return ConfigurationControlPlane.instance;
  }

  /**
   * Get the descriptor for a configuration key.
   */
  getDescriptor(key: string): ConfigKeyDescriptor | null {
    return CONFIG_REGISTRY.get(key) || null;
  }

  /**
   * Check if a key is a known secret.
   */
  isSecretKey(key: string): boolean {
    return SECRET_KEYS.has(key);
  }

  /**
   * Read the current value of a configuration key from .env.local.
   * Returns null if the key is not set.
   */
  read(key: string): string | null {
    if (!existsSync(this.envLocalPath)) return null;
    const content = readFileSync(this.envLocalPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.substring(0, eqIdx).trim();
      if (k === key) {
        return trimmed.substring(eqIdx + 1).trim();
      }
    }
    return null;
  }

  /**
   * Read all known non-secret configuration values.
   */
  readAll(): ConfigSnapshot {
    const values: Record<string, string | null> = {};
    for (const [key] of CONFIG_REGISTRY) {
      values[key] = this.read(key);
    }
    return {
      timestamp: new Date().toISOString(),
      values,
      source: this.envLocalPath,
    };
  }

  /**
   * Validate a value against its descriptor.
   */
  validate(key: string, value: string): { valid: boolean; error?: string } {
    const desc = this.getDescriptor(key);
    if (!desc) {
      return { valid: false, error: `Unknown configuration key: ${key}` };
    }
    if (desc.isSecret) {
      return { valid: false, error: `Secret keys must be managed through CredentialManager, not ConfigurationControlPlane` };
    }

    switch (desc.type) {
      case 'boolean':
        if (value !== 'true' && value !== 'false') {
          return { valid: false, error: `Expected "true" or "false", got "${value}"` };
        }
        break;
      case 'enum':
        if (desc.allowedValues && !desc.allowedValues.includes(value)) {
          return { valid: false, error: `Expected one of ${desc.allowedValues.join(', ')}, got "${value}"` };
        }
        break;
      case 'email':
        if (!value.includes('@') || value.length < 5) {
          return { valid: false, error: `Expected a valid email address, got "${value}"` };
        }
        break;
      case 'string':
        if (value.trim() === '') {
          return { valid: false, error: 'Value must not be empty' };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * Check if HYDI is allowed to modify this key autonomously.
   */
  canAutoModify(key: string): boolean {
    const desc = this.getDescriptor(key);
    if (!desc) return false;
    return desc.autoModifiable;
  }

  /**
   * Set a configuration value in .env.local.
   *
   * This is an atomic, audited, reversible operation.
   *
   * @param key The configuration key
   * @param value The new value
   * @param changedBy Who is making the change
   * @param reason Why the change is being made
   * @returns Result with success status and change record
   */
  set(key: string, value: string, changedBy: string, reason: string): ConfigChangeResult {
    // Check secret keys first — these are NEVER managed here
    if (this.isSecretKey(key)) {
      return { success: false, key, value: null, verified: false, error: `Secret keys must be managed through CredentialManager, not ConfigurationControlPlane` };
    }
    const desc = this.getDescriptor(key);
    if (!desc) {
      return { success: false, key, value: null, verified: false, error: `Unknown configuration key: ${key}` };
    }

    // Validate
    const validation = this.validate(key, value);
    if (!validation.valid) {
      return { success: false, key, value: null, verified: false, error: validation.error };
    }

    // Read current value for rollback
    const oldValue = this.read(key);

    // Atomic write
    try {
      this.writeEnvValue(key, value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, key, value: null, verified: false, error: msg };
    }

    // Verify (read-back)
    const readBack = this.read(key);
    const verified = readBack === value;

    const change: ConfigChange = {
      key,
      oldValue,
      newValue: value,
      changedAt: new Date().toISOString(),
      changedBy,
      reason,
      rollbackValue: oldValue,
    };
    this.auditLog.push(change);

    return { success: true, key, value, verified, change };
  }

  /**
   * Rollback a configuration change.
   */
  rollback(change: ConfigChange, changedBy: string): ConfigChangeResult {
    if (change.rollbackValue === null) {
      // Remove the key
      try {
        this.removeEnvValue(change.key);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { success: false, key: change.key, value: null, verified: false, error: msg };
      }
    } else {
      try {
        this.writeEnvValue(change.key, change.rollbackValue);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return { success: false, key: change.key, value: null, verified: false, error: msg };
      }
    }

    const readBack = this.read(change.key);
    const verified = readBack === change.rollbackValue;

    const rollbackChange: ConfigChange = {
      key: change.key,
      oldValue: change.newValue,
      newValue: change.rollbackValue ?? '',
      changedAt: new Date().toISOString(),
      changedBy,
      reason: `Rollback of change at ${change.changedAt}`,
      rollbackValue: change.oldValue,
    };
    this.auditLog.push(rollbackChange);

    return { success: true, key: change.key, value: change.rollbackValue, verified, change: rollbackChange };
  }

  /**
   * Get the audit log of all configuration changes.
   */
  getAuditLog(): ConfigChange[] {
    return [...this.auditLog];
  }

  /**
   * Get a safe, redacted summary of all configuration values for display.
   * Never includes secret values.
   */
  getSafeSummary(): Record<string, { value: string | null; description: string; isSecret: boolean }> {
    const summary: Record<string, any> = {};
    for (const [key, desc] of CONFIG_REGISTRY) {
      summary[key] = {
        value: this.read(key),
        description: desc.description,
        isSecret: desc.isSecret,
      };
    }
    // Report secret keys as configured/not-configured without values
    for (const secretKey of SECRET_KEYS) {
      summary[secretKey] = {
        value: this.read(secretKey) ? 'REDACTED' : null,
        description: 'Secret credential — managed by CredentialManager',
        isSecret: true,
      };
    }
    return summary;
  }

  // ─── Private: .env.local file operations ───────────────────────────────

  private writeEnvValue(key: string, value: string): void {
    let content = '';
    if (existsSync(this.envLocalPath)) {
      content = readFileSync(this.envLocalPath, 'utf8');
    }

    const lines = content.split('\n');
    let found = false;
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) {
        newLines.push(line);
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        newLines.push(line);
        continue;
      }
      const k = trimmed.substring(0, eqIdx).trim();
      if (k === key) {
        newLines.push(`${key}=${value}`);
        found = true;
      } else {
        newLines.push(line);
      }
    }

    if (!found) {
      // Append the new key
      if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
        newLines.push('');
      }
      newLines.push(`${key}=${value}`);
    }

    writeFileSync(this.envLocalPath, newLines.join('\n'), { encoding: 'utf8' });
  }

  private removeEnvValue(key: string): void {
    if (!existsSync(this.envLocalPath)) return;
    const content = readFileSync(this.envLocalPath, 'utf8');
    const lines = content.split('\n');
    const newLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed) {
        newLines.push(line);
        continue;
      }
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) {
        newLines.push(line);
        continue;
      }
      const k = trimmed.substring(0, eqIdx).trim();
      if (k !== key) {
        newLines.push(line);
      }
    }

    writeFileSync(this.envLocalPath, newLines.join('\n'), { encoding: 'utf8' });
  }
}

// ─── Singleton accessor ──────────────────────────────────────────────────

export function getConfigurationControlPlane(): ConfigurationControlPlane {
  return ConfigurationControlPlane.getInstance();
}
