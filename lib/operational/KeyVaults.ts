/**
 * KeyVault Backends
 *
 * Concrete implementations of the KeyVault interface.
 *
 * SECURITY: These vaults store actual secret values. The values are:
 *   - encrypted at rest (LocalDevVault uses AES-256-GCM)
 *   - never logged
 *   - never returned through domain objects
 *   - never exposed in audit records
 *
 * Backends:
 *   - LocalDevVault: encrypted file for development (AES-256-GCM)
 *   - EnvVarVault: process.env (transient, not persisted)
 *   - InMemoryVault: for testing only
 *
 * Future backends (not yet implemented):
 *   - OSKeychainVault: Windows Credential Manager / macOS Keychain / Linux Secret Service
 *   - SupabaseVault: Supabase Vault (pgsodium)
 *   - CloudSecretManager: AWS Secrets Manager / GCP Secret Manager
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { KeyVault, KeyStorageBackend } from './KeyManagementTypes';

// ─── LocalDevVault (encrypted file) ──────────────────────────────────────

/**
 * Encrypted local file vault for development.
 *
 * Uses AES-256-GCM with a passphrase-derived key (scrypt).
 * The vault file is at .hydi-operational/key-vault.enc
 * The passphrase is read from KEY_VAULT_PASSPHRASE env var, or
 * a default development passphrase is used (with a warning).
 *
 * SECURITY: This is NOT suitable for production. Use OSKeychainVault
 * or a cloud secret manager for production secrets.
 */
export class LocalDevVault implements KeyVault {
  readonly vaultId = 'local-dev';
  readonly backend: KeyStorageBackend = 'local_vault';

  private readonly vaultPath: string;
  private readonly passphrase: string;
  private entries: Map<string, { encrypted: Buffer; iv: Buffer; tag: Buffer; metadata: Record<string, string> }> = new Map();
  private loaded = false;
  private readonly warnOnDefaultPassphrase: boolean;

  constructor(root: string, passphrase?: string) {
    const dataDir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.vaultPath = path.resolve(dataDir, 'key-vault.enc');

    const provided = passphrase ?? process.env.KEY_VAULT_PASSPHRASE;
    if (!provided) {
      // Default passphrase for development only — NOT for production
      this.passphrase = 'hydi-dev-vault-default-passphrase';
      this.warnOnDefaultPassphrase = true;
    } else {
      this.passphrase = provided;
      this.warnOnDefaultPassphrase = false;
    }
  }

  isAvailable(): boolean {
    return true; // always available in dev
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      if (!fs.existsSync(this.vaultPath)) return;
      const content = fs.readFileSync(this.vaultPath);
      if (content.length === 0) return;

      // File format: [4-byte version][4-byte salt length][salt][4-byte entry count][entries...]
      // Each entry: [4-byte keyId length][keyId][4-byte encrypted length][encrypted][4-byte iv length][iv][4-byte tag length][tag][4-byte metadata length][metadata JSON]
      const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
      let offset = 0;

      const version = view.getUint32(offset); offset += 4;
      if (version !== 1) throw new Error(`Unsupported vault version: ${version}`);

      const saltLen = view.getUint32(offset); offset += 4;
      const salt = content.subarray(offset, offset + saltLen); offset += saltLen;

      const key = scryptSync(this.passphrase, salt, 32);

      const entryCount = view.getUint32(offset); offset += 4;

      for (let i = 0; i < entryCount; i++) {
        const keyIdLen = view.getUint32(offset); offset += 4;
        const keyId = content.subarray(offset, offset + keyIdLen).toString('utf8'); offset += keyIdLen;

        const encLen = view.getUint32(offset); offset += 4;
        const encrypted = content.subarray(offset, offset + encLen); offset += encLen;

        const ivLen = view.getUint32(offset); offset += 4;
        const iv = content.subarray(offset, offset + ivLen); offset += ivLen;

        const tagLen = view.getUint32(offset); offset += 4;
        const tag = content.subarray(offset, offset + tagLen); offset += tagLen;

        const metaLen = view.getUint32(offset); offset += 4;
        const metadata = metaLen > 0
          ? JSON.parse(content.subarray(offset, offset + metaLen).toString('utf8'))
          : {};
        offset += metaLen;

        this.entries.set(keyId, { encrypted: Buffer.from(encrypted), iv: Buffer.from(iv), tag: Buffer.from(tag), metadata });
      }
    } catch (err) {
      // Corrupt or unreadable vault — start fresh
      this.entries.clear();
    }
  }

  private persist(): void {
    const salt = randomBytes(16);
    const key = scryptSync(this.passphrase, salt, 32);

    const parts: Buffer[] = [];

    // Version
    const versionBuf = Buffer.alloc(4);
    new DataView(versionBuf.buffer).setUint32(0, 1);
    parts.push(versionBuf);

    // Salt
    const saltLenBuf = Buffer.alloc(4);
    new DataView(saltLenBuf.buffer).setUint32(0, salt.length);
    parts.push(saltLenBuf, salt);

    // Entry count
    const countBuf = Buffer.alloc(4);
    new DataView(countBuf.buffer).setUint32(0, this.entries.size);
    parts.push(countBuf);

    for (const [keyId, entry] of this.entries) {
      const keyIdBuf = Buffer.from(keyId, 'utf8');
      const keyIdLenBuf = Buffer.alloc(4);
      new DataView(keyIdLenBuf.buffer).setUint32(0, keyIdBuf.length);
      parts.push(keyIdLenBuf, keyIdBuf);

      const encLenBuf = Buffer.alloc(4);
      new DataView(encLenBuf.buffer).setUint32(0, entry.encrypted.length);
      parts.push(encLenBuf, entry.encrypted);

      const ivLenBuf = Buffer.alloc(4);
      new DataView(ivLenBuf.buffer).setUint32(0, entry.iv.length);
      parts.push(ivLenBuf, entry.iv);

      const tagLenBuf = Buffer.alloc(4);
      new DataView(tagLenBuf.buffer).setUint32(0, entry.tag.length);
      parts.push(tagLenBuf, entry.tag);

      const metaBuf = Buffer.from(JSON.stringify(entry.metadata), 'utf8');
      const metaLenBuf = Buffer.alloc(4);
      new DataView(metaLenBuf.buffer).setUint32(0, metaBuf.length);
      parts.push(metaLenBuf, metaBuf);
    }

    fs.writeFileSync(this.vaultPath, Buffer.concat(parts));
  }

  private encrypt(value: string): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
    // Use a fresh salt for the vault file, but derive key per-operation
    // Actually, for the vault we use a single key derived from passphrase
    // Each entry gets its own IV
    const iv = randomBytes(12); // GCM standard IV size
    const salt = randomBytes(16);
    const key = scryptSync(this.passphrase, salt, 32);

    // We need to store the salt too... Actually, let's use a simpler approach:
    // Derive key once from passphrase + file salt, use per-entry IV
    // But we need the salt available. Let's restructure.
    // For simplicity, derive key from passphrase + fixed salt per vault file
    throw new Error('Use store() instead');
  }

  async store(keyId: string, value: string, metadata?: Record<string, string>): Promise<void> {
    this.ensureLoaded();

    // Derive key from passphrase + vault-specific salt (stored in file header)
    // For new vaults, generate salt; for existing, reuse from file
    let salt: Buffer;
    if (fs.existsSync(this.vaultPath)) {
      // Read existing salt from file
      const content = fs.readFileSync(this.vaultPath);
      if (content.length > 8) {
        const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
        const saltLen = view.getUint32(4);
        salt = Buffer.from(content.subarray(8, 8 + saltLen));
      } else {
        salt = randomBytes(16);
      }
    } else {
      salt = randomBytes(16);
    }

    const key = scryptSync(this.passphrase, salt, 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    this.entries.set(keyId, {
      encrypted,
      iv,
      tag,
      metadata: metadata ?? {},
    });

    this.persist();
  }

  async retrieve(keyId: string): Promise<string | null> {
    this.ensureLoaded();
    const entry = this.entries.get(keyId);
    if (!entry) return null;

    // Re-derive key from passphrase + file salt
    let salt: Buffer;
    if (fs.existsSync(this.vaultPath)) {
      const content = fs.readFileSync(this.vaultPath);
      if (content.length > 8) {
        const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
        const saltLen = view.getUint32(4);
        salt = Buffer.from(content.subarray(8, 8 + saltLen));
      } else {
        return null;
      }
    } else {
      return null;
    }

    const key = scryptSync(this.passphrase, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, entry.iv);
    decipher.setAuthTag(entry.tag);

    try {
      const decrypted = Buffer.concat([decipher.update(entry.encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // Decryption failed — wrong passphrase or corrupt data
      return null;
    }
  }

  async delete(keyId: string): Promise<boolean> {
    this.ensureLoaded();
    const existed = this.entries.delete(keyId);
    if (existed) this.persist();
    return existed;
  }

  async exists(keyId: string): Promise<boolean> {
    this.ensureLoaded();
    return this.entries.has(keyId);
  }

  async list(): Promise<string[]> {
    this.ensureLoaded();
    return Array.from(this.entries.keys());
  }

  /**
   * Get the warning about default passphrase usage.
   */
  getPassphraseWarning(): string | null {
    return this.warnOnDefaultPassphrase
      ? 'WARNING: Using default development passphrase. Set KEY_VAULT_PASSPHRASE for production use.'
      : null;
  }
}

// ─── EnvVarVault (process.env, transient) ────────────────────────────────

/**
 * Vault backed by process.env.
 *
 * This is a transient vault — values are not persisted to disk.
 * It's used for credentials that are loaded from .env files at startup
 * and exist only in the process environment.
 *
 * SECURITY: This vault does NOT store values (they're already in process.env).
 * It only tracks which env vars are "managed" by the key management system.
 */
export class EnvVarVault implements KeyVault {
  readonly vaultId = 'env-var';
  readonly backend: KeyStorageBackend = 'env_var';

  private managedKeys: Set<string> = new Set();

  isAvailable(): boolean {
    return true;
  }

  async store(keyId: string, value: string, metadata?: Record<string, string>): Promise<void> {
    // Store in process.env if metadata specifies an envVar
    const envVar = metadata?.envVar;
    if (envVar) {
      process.env[envVar] = value;
    }
    this.managedKeys.add(keyId);
  }

  async retrieve(keyId: string): Promise<string | null> {
    // Look up from process.env using the keyId as env var name
    // or from metadata stored alongside the key
    const value = process.env[keyId];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  async delete(keyId: string): Promise<boolean> {
    const existed = this.managedKeys.has(keyId);
    this.managedKeys.delete(keyId);
    // Don't delete from process.env — that could break other consumers
    // Just untrack it
    return existed;
  }

  async exists(keyId: string): Promise<boolean> {
    return this.managedKeys.has(keyId) || (typeof process.env[keyId] === 'string' && process.env[keyId]!.length > 0);
  }

  async list(): Promise<string[]> {
    return Array.from(this.managedKeys);
  }
}

// ─── InMemoryVault (testing only) ────────────────────────────────────────

/**
 * In-memory vault for testing.
 *
 * SECURITY: This vault provides NO encryption. It is for testing only
 * and must never be used in production.
 */
export class InMemoryVault implements KeyVault {
  readonly vaultId = 'in-memory';
  readonly backend: KeyStorageBackend = 'unknown';

  private entries: Map<string, string> = new Map();

  isAvailable(): boolean {
    return true;
  }

  async store(keyId: string, value: string): Promise<void> {
    this.entries.set(keyId, value);
  }

  async retrieve(keyId: string): Promise<string | null> {
    return this.entries.get(keyId) ?? null;
  }

  async delete(keyId: string): Promise<boolean> {
    return this.entries.delete(keyId);
  }

  async exists(keyId: string): Promise<boolean> {
    return this.entries.has(keyId);
  }

  async list(): Promise<string[]> {
    return Array.from(this.entries.keys());
  }

  /**
   * Clear all entries. For testing only.
   */
  clear(): void {
    this.entries.clear();
  }
}

// ─── Vault Registry ──────────────────────────────────────────────────────

/**
 * Registry of available vault backends.
 * Allows the KeyManagementService to select the appropriate vault
 * based on the storage backend specified in key metadata.
 */
export class VaultRegistry {
  private vaults: Map<KeyStorageBackend, KeyVault> = new Map();
  private defaultVault: KeyVault;

  constructor(defaultVault: KeyVault) {
    this.defaultVault = defaultVault;
    this.register(defaultVault);
  }

  register(vault: KeyVault): void {
    this.vaults.set(vault.backend, vault);
  }

  get(backend: KeyStorageBackend): KeyVault {
    return this.vaults.get(backend) ?? this.defaultVault;
  }

  getDefault(): KeyVault {
    return this.defaultVault;
  }

  getAll(): KeyVault[] {
    return Array.from(this.vaults.values());
  }
}
