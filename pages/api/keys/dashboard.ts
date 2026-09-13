import { NextApiRequest, NextApiResponse } from 'next';
import { getKeyManagementService } from '../../../lib/operational/KeyManagementService';
import { KeyHealthMonitor } from '../../../lib/operational/KeyHealthMonitor';
import type { KeyMetadata } from '../../../lib/operational/KeyManagementTypes';

/**
 * GET /api/keys/dashboard — Unified credential operations dashboard
 *
 * Returns a single payload aggregating counts, provider health, vault
 * status, pending/failed rotations, recent lifecycle events, risk
 * distribution, and inventory drift.
 *
 * SECURITY: This endpoint NEVER exposes secret material. Only metadata,
 * fingerprints, lifecycle states, and audit-derived summaries are
 * returned. Secret values live exclusively in the KeyVault and are not
 * reachable through this response.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const kms = getKeyManagementService();
    const inventory = kms.getInventory();
    const keys = inventory.keys;
    const summary = inventory.summary;

    // ─── Credential counts by state ────────────────────────────────────
    // Derived from key metadata via the credential health assessment
    // (synchronous, metadata-only — no provider API calls).
    const monitor = new KeyHealthMonitor(kms);

    const counts = {
      total: keys.length,
      ready: 0,
      degraded: 0,
      blocked: 0,
      expired: 0,
      compromised: 0,
      rotationRequired: 0,
    };

    for (const key of keys) {
      if (key.lifecycleState === 'DESTROYED') continue;

      const credState = monitor.assessCredentialHealth(key);

      // Compromised takes priority
      if (credState === 'COMPROMISED') {
        counts.compromised++;
        continue;
      }
      if (credState === 'EXPIRED') {
        counts.expired++;
        continue;
      }
      if (credState === 'REVOKED' || credState === 'BLOCKED') {
        counts.blocked++;
        continue;
      }
      if (credState === 'ROTATION_REQUIRED' || credState === 'UNKNOWN') {
        counts.degraded++;
      } else {
        // VALID or EXPIRING_SOON — still usable
        counts.ready++;
      }

      // Rotation-required is tracked independently of the primary state
      if (
        key.rotationStatus === 'DUE' ||
        key.rotationStatus === 'OVERDUE' ||
        key.rotationStatus === 'IN_PROGRESS'
      ) {
        counts.rotationRequired++;
      }
    }

    // ─── Provider health summary ───────────────────────────────────────
    const providerMap = new Map<
      string,
      { provider: string; keyCount: number; healthy: number; issues: number }
    >();

    for (const key of keys) {
      if (key.lifecycleState === 'DESTROYED') continue;

      let entry = providerMap.get(key.provider);
      if (!entry) {
        entry = { provider: key.provider, keyCount: 0, healthy: 0, issues: 0 };
        providerMap.set(key.provider, entry);
      }

      entry.keyCount++;
      const credState = monitor.assessCredentialHealth(key);
      const isHealthy = credState === 'VALID' || credState === 'EXPIRING_SOON';
      if (isHealthy) {
        entry.healthy++;
      } else {
        entry.issues++;
      }
    }

    const providers = Array.from(providerMap.values());

    // ─── Vault health ──────────────────────────────────────────────────
    const vault = kms.getVaults().getDefault();
    const vaultHealth = {
      backend: vault.backend,
      available: vault.isAvailable(),
    };

    // ─── Pending rotations ─────────────────────────────────────────────
    const pendingRotations = keys
      .filter(
        k =>
          k.lifecycleState !== 'DESTROYED' &&
          (k.rotationStatus === 'DUE' ||
            k.rotationStatus === 'OVERDUE' ||
            k.rotationStatus === 'IN_PROGRESS'),
      )
      .map(k => ({
        keyId: k.id,
        provider: k.provider,
        envVar: k.envVar,
        rotationStatus: k.rotationStatus,
        lastRotatedAt: k.lastRotatedAt,
      }));

    // ─── Failed rotations ──────────────────────────────────────────────
    // Keys whose last rotation attempt failed (metadata) plus any ROTATE
    // audit records carrying a failure reason.
    const failedRotations: Array<{ keyId: string; provider: string; failureReason: string }> = [];

    for (const key of keys) {
      if (key.rotationStatus === 'FAILED') {
        failedRotations.push({
          keyId: key.id,
          provider: key.provider,
          failureReason: 'Last rotation attempt failed',
        });
      }
    }

    // Augment with failed ROTATE audit records (deduped by keyId)
    const audit = kms.getAuditService();
    const recentAudit = audit.getRecent(200);
    const seenFailedKeyIds = new Set(failedRotations.map(f => f.keyId));
    for (const rec of recentAudit) {
      if (rec.operation !== 'ROTATE') continue;
      if (!rec.failureReason) continue;
      if (seenFailedKeyIds.has(rec.keyId)) continue;
      seenFailedKeyIds.add(rec.keyId);
      failedRotations.push({
        keyId: rec.keyId,
        provider: rec.provider,
        failureReason: rec.failureReason,
      });
    }

    // ─── Recent lifecycle events (last 10) ─────────────────────────────
    const recentEvents = audit
      .getRecent(10)
      .reverse() // most recent first
      .map(rec => ({
        operation: rec.operation,
        keyId: rec.keyId,
        provider: rec.provider,
        timestamp: rec.timestamp,
        success: !rec.failureReason,
      }));

    // ─── Risk distribution ─────────────────────────────────────────────
    const riskDistribution = {
      LOW: summary.byRiskLevel.LOW ?? 0,
      MEDIUM: summary.byRiskLevel.MEDIUM ?? 0,
      HIGH: summary.byRiskLevel.HIGH ?? 0,
      CRITICAL: summary.byRiskLevel.CRITICAL ?? 0,
    };

    // ─── Inventory drift ───────────────────────────────────────────────
    // Compare the durable inventory against what providers discover from
    // the live environment. This is metadata-only (env var names / ids).
    let inInventoryButNotProvider = 0;
    let inProviderButNotInventory = 0;

    try {
      const discovered = await kms.getProviders().discoverAll();
      const inventoryIds = new Set(keys.map(k => k.envVar ?? k.id));
      const providerIds = new Set(discovered.map(k => k.envVar ?? k.id));

      for (const id of inventoryIds) {
        if (!providerIds.has(id)) inInventoryButNotProvider++;
      }
      for (const id of providerIds) {
        if (!inventoryIds.has(id)) inProviderButNotInventory++;
      }
    } catch {
      // Discovery may fail in restricted environments — report zero drift
      // rather than failing the entire dashboard payload.
      inInventoryButNotProvider = 0;
      inProviderButNotInventory = 0;
    }

    const inventoryDrift = {
      inInventoryButNotProvider,
      inProviderButNotInventory,
    };

    return res.status(200).json({
      counts,
      providers,
      vaultHealth,
      pendingRotations,
      failedRotations,
      recentEvents,
      riskDistribution,
      inventoryDrift,
    });
  } catch (error) {
    console.error('Key dashboard API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
