/**
 * Key Inventory Store
 *
 * Durable storage for key metadata. Persists to JSONL at
 * .hydi-operational/key-inventory.jsonl and survives restarts.
 *
 * SECURITY: This store contains metadata ONLY — fingerprints, lifecycle
 * states, timestamps, provider info. It NEVER contains secret values.
 * The actual secret values live in the KeyVault.
 *
 * This follows the same pattern as PolicyDecisionRecordStore and
 * DurableAcquisitionStore (JSONL with rotation).
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { KeyMetadata, KeyInventory, KeyInventorySummary, KeyLifecycleState, KeyRiskLevel, KeyStorageBackend } from './KeyManagementTypes';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Durable store for key metadata (inventory).
 *
 * The inventory is the authoritative record of all managed keys.
 * It is reconciled with the environment and vault on each health check.
 */
export class KeyInventoryStore {
  private filePath: string;
  private keys: Map<string, KeyMetadata> = new Map();

  constructor(root: string) {
    const dataDir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.resolve(dataDir, 'key-inventory.jsonl');
    this.load();
  }

  /**
   * Add or update a key in the inventory.
   */
  upsert(key: KeyMetadata): void {
    this.keys.set(key.id, key);
    this.persist();
  }

  /**
   * Get a key by ID.
   */
  get(keyId: string): KeyMetadata | null {
    return this.keys.get(keyId) ?? null;
  }

  /**
   * Get a key by its env var name.
   */
  getByEnvVar(envVar: string): KeyMetadata | null {
    for (const key of this.keys.values()) {
      if (key.envVar === envVar) return key;
    }
    return null;
  }

  /**
   * Get all keys by provider.
   */
  getByProvider(provider: string): KeyMetadata[] {
    return Array.from(this.keys.values()).filter(k => k.provider === provider);
  }

  /**
   * Get all keys.
   */
  getAll(): KeyMetadata[] {
    return Array.from(this.keys.values());
  }

  /**
   * Remove a key from the inventory.
   */
  remove(keyId: string): boolean {
    const existed = this.keys.delete(keyId);
    if (existed) this.persist();
    return existed;
  }

  /**
   * Update a key's lifecycle state.
   */
  updateLifecycleState(keyId: string, newState: KeyLifecycleState): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    key.lifecycleState = newState;
    this.keys.set(keyId, key);
    this.persist();
    return true;
  }

  /**
   * Update a key's validation result.
   */
  updateValidation(keyId: string, result: import('./CapabilityAcquisitionTypes').CredentialState): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    key.lastValidationAt = new Date().toISOString();
    key.lastValidationResult = result;
    this.keys.set(keyId, key);
    this.persist();
    return true;
  }

  /**
   * Update a key's rotation timestamp.
   */
  updateRotation(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    key.lastRotatedAt = new Date().toISOString();
    key.rotationStatus = 'NOT_DUE';
    this.keys.set(keyId, key);
    this.persist();
    return true;
  }

  /**
   * Update a key's compromise status.
   */
  updateCompromiseStatus(keyId: string, status: KeyMetadata['compromiseStatus']): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    key.compromiseStatus = status;
    this.keys.set(keyId, key);
    this.persist();
    return true;
  }

  /**
   * Get the full inventory with summary.
   */
  getInventory(): KeyInventory {
    const keys = this.getAll();
    return {
      keys,
      summary: this.computeSummary(keys),
      lastReconciledAt: new Date().toISOString(),
    };
  }

  /**
   * Compute summary statistics.
   */
  computeSummary(keys: KeyMetadata[]): KeyInventorySummary {
    const summary: KeyInventorySummary = {
      total: keys.length,
      active: 0,
      expiring: 0,
      expired: 0,
      rotationDue: 0,
      rotationOverdue: 0,
      compromised: 0,
      revoked: 0,
      destroyed: 0,
      byRiskLevel: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      byProvider: {},
      byStorageBackend: {
        env_file: 0, env_var: 0, os_keychain: 0, local_vault: 0,
        docker_secret: 0, supabase_vault: 0, cloud_sm: 0, hsm: 0, unknown: 0,
      },
    };

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const key of keys) {
      // Lifecycle state counts
      if (key.lifecycleState === 'ACTIVE') summary.active++;
      if (key.lifecycleState === 'REVOKED') summary.revoked++;
      if (key.lifecycleState === 'DESTROYED') summary.destroyed++;
      if (key.compromiseStatus === 'SUSPECTED' || key.compromiseStatus === 'CONFIRMED' || key.compromiseStatus === 'ISOLATED') {
        summary.compromised++;
      }

      // Expiration
      if (key.expiresAt) {
        const expiresMs = new Date(key.expiresAt).getTime();
        if (expiresMs < now) {
          summary.expired++;
        } else if (expiresMs - now < sevenDaysMs) {
          summary.expiring++;
        }
      }

      // Rotation
      if (key.rotationStatus === 'DUE') summary.rotationDue++;
      if (key.rotationStatus === 'OVERDUE') summary.rotationOverdue++;

      // By risk level
      summary.byRiskLevel[key.riskLevel] = (summary.byRiskLevel[key.riskLevel] ?? 0) + 1;

      // By provider
      summary.byProvider[key.provider] = (summary.byProvider[key.provider] ?? 0) + 1;

      // By storage backend
      summary.byStorageBackend[key.storageBackend] = (summary.byStorageBackend[key.storageBackend] ?? 0) + 1;
    }

    return summary;
  }

  /**
   * Reconcile the inventory with discovered keys from providers.
   * Adds newly discovered keys and updates fingerprints for changed keys.
   */
  reconcile(discovered: KeyMetadata[]): { added: KeyMetadata[]; updated: KeyMetadata[]; removed: KeyMetadata[] } {
    const added: KeyMetadata[] = [];
    const updated: KeyMetadata[] = [];
    const removed: KeyMetadata[] = [];

    // Track which env vars we've seen
    const seenEnvVars = new Set<string>();

    for (const discoveredKey of discovered) {
      seenEnvVars.add(discoveredKey.envVar ?? discoveredKey.id);

      // Try to find by env var
      const existing = discoveredKey.envVar ? this.getByEnvVar(discoveredKey.envVar) : null;

      if (!existing) {
        // New key — add to inventory
        const newKey: KeyMetadata = {
          ...discoveredKey,
          id: discoveredKey.id || randomUUID(),
          lifecycleState: 'DISCOVERED',
        };
        this.upsert(newKey);
        added.push(newKey);
      } else {
        // Existing key — check if fingerprint changed
        if (existing.fingerprint !== discoveredKey.fingerprint) {
          // Fingerprint changed — key was rotated externally
          const updatedKey: KeyMetadata = {
            ...existing,
            fingerprint: discoveredKey.fingerprint,
            lastRotatedAt: new Date().toISOString(),
            lifecycleState: 'ACTIVE',
          };
          this.upsert(updatedKey);
          updated.push(updatedKey);
        }
      }
    }

    // Check for removed keys (in inventory but not in environment)
    for (const [keyId, key] of this.keys) {
      if (key.envVar && !seenEnvVars.has(key.envVar) && key.lifecycleState !== 'DESTROYED') {
        // Key was in inventory but is no longer in the environment
        const removedKey: KeyMetadata = {
          ...key,
          lifecycleState: 'DESTROYED',
        };
        this.upsert(removedKey);
        removed.push(removedKey);
      }
    }

    return { added, updated, removed };
  }

  private persist(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          this.rotate();
        }
      }
      // Write all keys as JSONL (overwrite — this is the current state)
      const lines = Array.from(this.keys.values()).map(k => JSON.stringify(k)).join('\n');
      fs.writeFileSync(this.filePath, lines + '\n');
    } catch { /* best effort */ }
  }

  private rotate(): void {
    try {
      const backupPath = this.filePath.replace('.jsonl', `.${Date.now()}.jsonl`);
      fs.renameSync(this.filePath, backupPath);
    } catch { /* best effort */ }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const key = JSON.parse(line) as KeyMetadata;
          this.keys.set(key.id, key);
        } catch { /* skip malformed */ }
      }
    } catch { /* file may not exist yet */ }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let inventoryInstance: KeyInventoryStore | null = null;

export function getKeyInventoryStore(root?: string): KeyInventoryStore {
  if (!inventoryInstance) {
    inventoryInstance = new KeyInventoryStore(root ?? process.cwd());
  }
  return inventoryInstance;
}

export function resetKeyInventoryStore(): void {
  inventoryInstance = null;
}
