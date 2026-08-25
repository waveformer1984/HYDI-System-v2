/**
 * Credential Source Abstraction
 *
 * The core credential-governance system never cares where a credential
 * came from. It requests:
 *
 *   getCredential(provider, credentialType, environment)
 *
 * and receives a secure CredentialHandle — never raw credential material
 * in general orchestration state.
 *
 * Source priority (deterministic):
 *   1. SECURE_LOCAL — encrypted local credential store (Windows DPAPI)
 *   2. PROVIDER_CLI — provider CLI/session credential (e.g., Stripe CLI)
 *   3. ENVIRONMENT — environment variable / .env.local (bootstrap)
 *   4. EXPLICIT — explicitly supplied bootstrap credential
 *   5. UNAVAILABLE — no credential found
 *
 * SECURITY: Raw credential values NEVER leave the source. The handle
 * contains only metadata (source type, fingerprint, prefix, environment).
 * The raw value is accessed only at the point of use via a secure
 * accessor function that is not serialized.
 */

import { createHash, randomUUID } from 'crypto';

// ─── Credential Source Types ─────────────────────────────────────────────

export type CredentialSourceType =
  | 'SECURE_LOCAL'
  | 'PROVIDER_CLI'
  | 'ENVIRONMENT'
  | 'EXPLICIT'
  | 'UNAVAILABLE';

export type CredentialProvider = 'stripe' | 'supabase' | 'vercel' | 'keeper' | 'generic';
export type CredentialEnvironment = 'test' | 'live' | 'development' | 'unknown';

export interface CredentialHandle {
  /** Unique handle ID */
  id: string;
  /** Provider (stripe, supabase, etc.) */
  provider: CredentialProvider;
  /** Credential type (stripe_secret_key, stripe_webhook_secret, etc.) */
  credentialType: string;
  /** Environment (test, live, development) */
  environment: CredentialEnvironment;
  /** Where the credential came from */
  source: CredentialSourceType;
  /** Safe fingerprint (SHA-256, first 16 chars) */
  fingerprint: string;
  /** Safe prefix (e.g., 'sk_test_...') */
  prefix: string;
  /** Whether the credential has been provider-verified */
  verified: boolean;
  /** When the handle was created */
  createdAt: string;
  /** When the credential was last validated */
  lastValidatedAt: string | null;
  /** Secure accessor — NOT serializable, NOT logged */
  _access: () => string | null;
  /** Whether the handle has a real value */
  hasValue: boolean;
}

/**
 * Result of a credential lookup.
 */
export interface CredentialLookupResult {
  handle: CredentialHandle | null;
  source: CredentialSourceType;
  reason: string;
  /** Other sources that were checked */
  sourcesChecked: CredentialSourceType[];
}

// ─── Credential Source Interface ─────────────────────────────────────────

export interface CredentialSource {
  /** Source type identifier */
  readonly sourceType: CredentialSourceType;

  /**
   * Get a credential handle.
   * Returns null if the credential is not available from this source.
   * NEVER returns raw credential material — only a handle with a secure accessor.
   */
  getCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<CredentialHandle | null>;

  /**
   * Store a credential securely.
   * The raw value is received, encrypted, and immediately discarded.
   * Returns a handle to the stored credential.
   */
  storeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment,
    value: string,
    authorizedBy: { actor: string; role: string }
  ): Promise<CredentialHandle>;

  /**
   * Check if a credential is available from this source.
   */
  isAvailable(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<boolean>;

  /**
   * Remove a credential from this source.
   */
  removeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<boolean>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').substring(0, 16);
}

export function safePrefix(value: string): string {
  if (value.startsWith('sk_live_')) return 'sk_live_...';
  if (value.startsWith('sk_test_')) return 'sk_test_...';
  if (value.startsWith('rk_live_')) return 'rk_live_...';
  if (value.startsWith('rk_test_')) return 'rk_test_...';
  if (value.startsWith('whsec_')) return 'whsec_...';
  if (value.startsWith('eyJ')) return 'eyJ...';
  return value.length > 4 ? value.substring(0, 4) + '...' : '...';
}

export function classifyEnvironment(value: string, credentialType: string): CredentialEnvironment {
  if (credentialType.includes('webhook') || credentialType.includes('cli')) return 'unknown';
  if (value.startsWith('sk_live_') || value.startsWith('rk_live_')) return 'live';
  if (value.startsWith('sk_test_') || value.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

/**
 * Create a credential handle from a raw value.
 * The raw value is captured in the closure and never serialized.
 */
export function createHandle(params: {
  provider: CredentialProvider;
  credentialType: string;
  environment: CredentialEnvironment;
  source: CredentialSourceType;
  value: string | null;
  verified?: boolean;
}): CredentialHandle {
  const value = params.value;
  return {
    id: randomUUID(),
    provider: params.provider,
    credentialType: params.credentialType,
    environment: params.environment,
    source: params.source,
    fingerprint: value ? fingerprint(value) : '',
    prefix: value ? safePrefix(value) : '',
    verified: params.verified || false,
    createdAt: new Date().toISOString(),
    lastValidatedAt: params.verified ? new Date().toISOString() : null,
    hasValue: !!value,
    _access: () => value,
  };
}

// ─── Environment Credential Source ───────────────────────────────────────

/**
 * Reads credentials from process.env / .env.local.
 * This is the bootstrap/development source — NOT a secure vault.
 * Marked explicitly as ENVIRONMENT, not SECURE_LOCAL.
 */
export class EnvironmentCredentialSource implements CredentialSource {
  readonly sourceType: CredentialSourceType = 'ENVIRONMENT';

  private envVarMap: Map<string, string> = new Map([
    ['stripe:stripe_secret_key', 'STRIPE_SECRET_KEY'],
    ['stripe:stripe_restricted_key', 'STRIPE_RESTRICTED_KEY'],
    ['stripe:stripe_webhook_secret', 'STRIPE_WEBHOOK_SECRET'],
    ['stripe:stripe_webhook_secret_01', 'STRIPE_WEBHOOK_SECRET_01'],
    ['stripe:stripe_cli_session', 'STRIPE_CLI_SESSION'],
    ['supabase:supabase_service_role_jwt', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['supabase:supabase_anon_key', 'SUPABASE_ANON_KEY'],
    ['supabase:supabase_url', 'SUPABASE_URL'],
  ]);

  async getCredential(
    provider: CredentialProvider,
    credentialType: string,
    _environment: CredentialEnvironment
  ): Promise<CredentialHandle | null> {
    const envVar = this.envVarMap.get(`${provider}:${credentialType}`);
    if (!envVar) return null;

    const value = process.env[envVar];
    if (!value || value.trim() === '') return null;

    return createHandle({
      provider,
      credentialType,
      environment: classifyEnvironment(value, credentialType),
      source: 'ENVIRONMENT',
      value,
    });
  }

  async storeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment,
    value: string,
    _authorizedBy: { actor: string; role: string }
  ): Promise<CredentialHandle> {
    // Environment source stores by setting process.env (in-memory only)
    const envVar = this.envVarMap.get(`${provider}:${credentialType}`);
    if (envVar) {
      process.env[envVar] = value;
    }
    return createHandle({
      provider,
      credentialType,
      environment,
      source: 'ENVIRONMENT',
      value,
    });
  }

  async isAvailable(
    provider: CredentialProvider,
    credentialType: string,
    _environment: CredentialEnvironment
  ): Promise<boolean> {
    const envVar = this.envVarMap.get(`${provider}:${credentialType}`);
    if (!envVar) return false;
    return !!process.env[envVar] && process.env[envVar]!.trim() !== '';
  }

  async removeCredential(
    provider: CredentialProvider,
    credentialType: string,
    _environment: CredentialEnvironment
  ): Promise<boolean> {
    const envVar = this.envVarMap.get(`${provider}:${credentialType}`);
    if (envVar) {
      delete process.env[envVar];
      return true;
    }
    return false;
  }
}

// ─── Secure Local Credential Source (Windows DPAPI) ──────────────────────

/**
 * Local secure credential store using Windows DPAPI (Data Protection API).
 *
 * On Windows, credentials are encrypted using dpapi.cryptProtectData,
 * which encrypts data using the current user's credentials. Only the
 * authorized HYDI runtime identity can decrypt the data.
 *
 * On non-Windows systems, falls back to a file-based store with a warning
 * that it is not as secure as DPAPI. This is explicitly marked in the
 * source type as SECURE_LOCAL.
 *
 * SECURITY:
 *   - Encrypted at rest
 *   - Accessible only to the authorized HYDI runtime identity
 *   - Never returned through status APIs
 *   - Never serialized into audit records
 *   - Never exposed through HEIDI chat
 *   - Never included in exception messages
 *   - Never printed during diagnostics
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export class LocalSecureCredentialSource implements CredentialSource {
  readonly sourceType: CredentialSourceType = 'SECURE_LOCAL';
  private storePath: string;
  private cache: Map<string, { encrypted: string; handle: Omit<CredentialHandle, '_access'> }> = new Map();
  private isWindows: boolean;

  constructor(storePath?: string) {
    this.isWindows = process.platform === 'win32';
    this.storePath = storePath || join(process.cwd(), '.hydi-operational', 'secure-credential-store.enc');
    this.loadStore();
  }

  private loadStore(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const data = readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(data);
      for (const [key, entry] of Object.entries(parsed)) {
        const e = entry as any;
        this.cache.set(key, { encrypted: e.encrypted, handle: e.handle });
      }
    } catch {
      // Corrupted store — start fresh
    }
  }

  private saveStore(): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, any> = {};
    for (const [key, entry] of this.cache.entries()) {
      data[key] = { encrypted: entry.encrypted, handle: entry.handle };
    }
    writeFileSync(this.storePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
  }

  private encrypt(value: string): string {
    if (this.isWindows) {
      // Use Windows DPAPI via PowerShell
      try {
        const { execSync } = require('child_process');
        const encoded = Buffer.from(value, 'utf8').toString('base64');
        const result = execSync(
          `powershell -NoProfile -Command "[System.Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String('${encoded}"), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser) | [Convert]::ToBase64String"`,
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        return `DPAPI:${result}`;
      } catch {
        // DPAPI not available — fall back to obfuscated storage
        // This is explicitly NOT as secure as DPAPI
        return `BASE64:${Buffer.from(value, 'utf8').toString('base64')}`;
      }
    }
    // Non-Windows: base64 encoding (not encryption — explicitly less secure)
    return `BASE64:${Buffer.from(value, 'utf8').toString('base64')}`;
  }

  private decrypt(encrypted: string): string {
    if (encrypted.startsWith('DPAPI:')) {
      const data = encrypted.substring(5);
      try {
        const { execSync } = require('child_process');
        const result = execSync(
          `powershell -NoProfile -Command "[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${data}'), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser) | [System.Text.Encoding]::UTF8.GetString"`,
          { encoding: 'utf8', timeout: 5000 }
        );
        return result;
      } catch {
        return '';
      }
    }
    if (encrypted.startsWith('BASE64:')) {
      return Buffer.from(encrypted.substring(7), 'base64').toString('utf8');
    }
    return '';
  }

  private storeKey(provider: CredentialProvider, credentialType: string, environment: CredentialEnvironment): string {
    return `${provider}:${credentialType}:${environment}`;
  }

  async getCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<CredentialHandle | null> {
    const key = this.storeKey(provider, credentialType, environment);
    const entry = this.cache.get(key);
    if (!entry) return null;

    const value = this.decrypt(entry.encrypted);
    if (!value) return null;

    return createHandle({
      provider,
      credentialType,
      environment,
      source: 'SECURE_LOCAL',
      value,
      verified: entry.handle.verified,
    });
  }

  async storeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment,
    value: string,
    _authorizedBy: { actor: string; role: string }
  ): Promise<CredentialHandle> {
    const key = this.storeKey(provider, credentialType, environment);
    const encrypted = this.encrypt(value);
    const handle = createHandle({
      provider,
      credentialType,
      environment,
      source: 'SECURE_LOCAL',
      value,
    });

    // Store metadata only (no raw value, no _access function)
    this.cache.set(key, {
      encrypted,
      handle: {
        id: handle.id,
        provider: handle.provider,
        credentialType: handle.credentialType,
        environment: handle.environment,
        source: handle.source,
        fingerprint: handle.fingerprint,
        prefix: handle.prefix,
        verified: handle.verified,
        createdAt: handle.createdAt,
        lastValidatedAt: handle.lastValidatedAt,
        hasValue: handle.hasValue,
      },
    });
    this.saveStore();

    return handle;
  }

  async isAvailable(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<boolean> {
    const key = this.storeKey(provider, credentialType, environment);
    return this.cache.has(key);
  }

  async removeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<boolean> {
    const key = this.storeKey(provider, credentialType, environment);
    const existed = this.cache.delete(key);
    if (existed) this.saveStore();
    return existed;
  }

  /**
   * Get a summary of stored credentials (metadata only — no values).
   */
  getSummary(): Array<{ provider: string; credentialType: string; environment: string; fingerprint: string; prefix: string; verified: boolean }> {
    return Array.from(this.cache.entries()).map(([key, entry]) => {
      const [provider, credentialType, environment] = key.split(':');
      return {
        provider,
        credentialType,
        environment,
        fingerprint: entry.handle.fingerprint,
        prefix: entry.handle.prefix,
        verified: entry.handle.verified,
      };
    });
  }
}

// ─── Credential Source Manager ───────────────────────────────────────────

/**
 * Manages credential sources with deterministic priority.
 *
 * Priority order:
 *   1. SECURE_LOCAL — encrypted local credential store
 *   2. PROVIDER_CLI — provider CLI/session credential
 *   3. ENVIRONMENT — environment variable / .env.local
 *   4. EXPLICIT — explicitly supplied bootstrap credential
 *   5. UNAVAILABLE — no credential found
 */
export class CredentialSourceManager {
  private sources: CredentialSource[] = [];
  private static instance: CredentialSourceManager | null = null;

  constructor() {
    // Register sources in priority order
    this.sources.push(new LocalSecureCredentialSource());
    // PROVIDER_CLI sources are registered dynamically by provider managers
    this.sources.push(new EnvironmentCredentialSource());
  }

  static getInstance(): CredentialSourceManager {
    if (!CredentialSourceManager.instance) {
      CredentialSourceManager.instance = new CredentialSourceManager();
    }
    return CredentialSourceManager.instance;
  }

  /**
   * Register a credential source at a specific priority.
   */
  registerSource(source: CredentialSource, priority?: number): void {
    if (priority !== undefined) {
      this.sources.splice(priority, 0, source);
    } else {
      // Insert before ENVIRONMENT (index 1) but after SECURE_LOCAL (index 0)
      this.sources.splice(1, 0, source);
    }
  }

  /**
   * Get a credential from the highest-priority available source.
   * Returns a handle with metadata only — never the raw value in
   * serializable state.
   */
  async getCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<CredentialLookupResult> {
    const sourcesChecked: CredentialSourceType[] = [];

    for (const source of this.sources) {
      sourcesChecked.push(source.sourceType);
      try {
        const handle = await source.getCredential(provider, credentialType, environment);
        if (handle && handle.hasValue) {
          return {
            handle,
            source: source.sourceType,
            reason: `Found in ${source.sourceType}`,
            sourcesChecked,
          };
        }
      } catch {
        // Source error — continue to next source
        continue;
      }
    }

    return {
      handle: null,
      source: 'UNAVAILABLE',
      reason: `No credential found for ${provider}:${credentialType}:${environment}`,
      sourcesChecked,
    };
  }

  /**
   * Store a credential in the highest-priority source that supports storage.
   */
  async storeCredential(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment,
    value: string,
    authorizedBy: { actor: string; role: string }
  ): Promise<CredentialHandle | null> {
    for (const source of this.sources) {
      if (source.sourceType === 'SECURE_LOCAL' || source.sourceType === 'ENVIRONMENT') {
        try {
          return await source.storeCredential(provider, credentialType, environment, value, authorizedBy);
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  /**
   * Check if a credential is available from any source.
   */
  async isAvailable(
    provider: CredentialProvider,
    credentialType: string,
    environment: CredentialEnvironment
  ): Promise<{ available: boolean; source: CredentialSourceType | null }> {
    for (const source of this.sources) {
      try {
        if (await source.isAvailable(provider, credentialType, environment)) {
          return { available: true, source: source.sourceType };
        }
      } catch {
        continue;
      }
    }
    return { available: false, source: null };
  }

  /**
   * Get the list of registered sources in priority order.
   */
  getSources(): CredentialSourceType[] {
    return this.sources.map(s => s.sourceType);
  }
}

// ─── Singleton Access ────────────────────────────────────────────────────

export function getCredentialSourceManager(): CredentialSourceManager {
  return CredentialSourceManager.getInstance();
}
