import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/heidi-status
 *
 * Live status of the HEIDI system. No fabricated values.
 * Every field is backed by a real check.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const fs = await import('fs');
    const path = await import('path');

    // ─── Daemon state ─────────────────────────────────────────────────
    let daemonState: any = { online: false };
    try {
      const lockPath = path.resolve(process.cwd(), '.heidi-daemon.lock');
      if (fs.existsSync(lockPath)) {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        try {
          process.kill(lock.pid, 0);
          daemonState = { online: true, pid: lock.pid, startedAt: lock.startedAt };
        } catch {
          daemonState = { online: false, pid: lock.pid, error: 'Process not alive' };
        }
      }
    } catch { /* best effort */ }

    // ─── Cycle count from audit log ───────────────────────────────────
    let cycleCount = 0;
    let lastCycle: string | null = null;
    let lastDecision: string | null = null;
    let lastVerification: string | null = null;
    try {
      const auditPath = path.resolve(process.cwd(), '.heidi-daemon-audit.jsonl');
      if (fs.existsSync(auditPath)) {
        const content = fs.readFileSync(auditPath, 'utf8').trim();
        const lines = content.split('\n').filter(Boolean);
        cycleCount = lines.length;
        // Get last cycle info
        const lastRecord = JSON.parse(lines[lines.length - 1]);
        lastCycle = lastRecord.timestamp || null;
        if (lastRecord.selfRepairResult) {
          lastDecision = `Repaired ${lastRecord.selfRepairResult.repaired}, escalated ${lastRecord.selfRepairResult.escalated}`;
        }
        if (lastRecord.acquisitionResult) {
          lastVerification = `Acquired ${lastRecord.acquisitionResult.resolved}, escalated ${lastRecord.acquisitionResult.escalated}`;
        }
      }
    } catch { /* best effort */ }

    // ─── Capabilities ─────────────────────────────────────────────────
    const capabilities: any = {};
    const capabilitySummary = { total: 0, ready: 0, blocked: 0, policyBlocked: 0, failed: 0 };
    try {
      const { getAcquisitionEngine } = await import('../../lib/operational/ExternalCapabilityAcquisitionEngine');
      const { getProviderAdapterRegistry } = await import('../../lib/operational/ProviderAdapters');
      const engine = getAcquisitionEngine();
      const registry = getProviderAdapterRegistry();
      const adapters = registry.getAllAdapters();

      for (const adapter of adapters) {
        const state = engine.getCapabilityState(adapter.capabilityId);
        capabilities[adapter.providerId] = state;
        capabilitySummary.total++;
        if (state === 'READY') capabilitySummary.ready++;
        else if (state === 'BLOCKED') capabilitySummary.blocked++;
        else if (state === 'POLICY_BLOCKED') capabilitySummary.policyBlocked++;
        else if (state.includes('FAILED')) capabilitySummary.failed++;
      }
    } catch { /* best effort */ }

    // ─── Pending authorizations ───────────────────────────────────────
    let pendingAuthorization = 0;
    let pendingRequests: any[] = [];
    try {
      const { getOwnerAuthorizationStore } = await import('../../lib/operational/OwnerAuthorizationStore');
      const store = getOwnerAuthorizationStore();
      store.cleanupExpired();
      pendingRequests = store.getPendingRequests();
      pendingAuthorization = pendingRequests.length;
    } catch { /* best effort */ }

    // ─── Durable persistence state ────────────────────────────────────
    let persistenceState: any = { healthy: false };
    try {
      const opDir = path.resolve(process.cwd(), '.hydi-operational');
      persistenceState = {
        healthy: fs.existsSync(opDir),
        dir: opDir,
        stores: fs.existsSync(opDir) ? fs.readdirSync(opDir) : [],
      };
    } catch { /* best effort */ }

    // ─── Active recovery ──────────────────────────────────────────────
    let activeRecovery: any = null;
    try {
      const { getDurableAcquisitionStore } = await import('../../lib/operational/DurableAcquisitionStore');
      const store = getDurableAcquisitionStore();
      const inProgress = store.getInProgressAcquisitions();
      if (inProgress.length > 0) {
        activeRecovery = inProgress.map((r) => ({
          capabilityId: r.capabilityId,
          provider: r.provider,
          state: r.currentState,
          retryCount: r.retryCount,
          lastError: r.lastError,
        }));
      }
    } catch { /* best effort */ }

    const status = {
      heidi: daemonState.online ? 'ONLINE' : 'OFFLINE',
      autonomy: daemonState.online ? 'ACTIVE' : 'INACTIVE',
      cycle: cycleCount,
      lastCycle,
      lastDecision,
      lastVerification,
      daemon: daemonState,
      capabilities,
      capabilitySummary,
      activeRecovery,
      pendingAuthorization,
      pendingRequests: pendingRequests.map((r) => ({
        id: r.id,
        provider: r.provider,
        reason: r.reason,
        status: r.status,
        requestedAt: r.requestedAt,
      })),
      persistence: persistenceState,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(status);
  } catch (error) {
    console.error('[/api/heidi-status] Error:', error);
    res.status(500).json({
      heidi: 'FAILED',
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
