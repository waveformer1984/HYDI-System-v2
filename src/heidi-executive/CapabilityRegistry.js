/**
 * HEIDI Operational Control Plane — Capability Registry
 * Canonical registry of executable actions.
 */

const RISK_LEVELS = ['READ', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
    this.registerDefaults();
  }

  register(capability) {
    if (!capability || !capability.id) throw new Error('Capability id is required');
    if (!RISK_LEVELS.includes(capability.riskLevel)) {
      throw new Error(`Invalid risk level: ${capability.riskLevel}`);
    }
    this.capabilities.set(capability.id, {
      id: capability.id,
      description: capability.description || '',
      riskLevel: capability.riskLevel,
      environment: capability.environment || 'any',
      allowedTargets: capability.allowedTargets || [],
      requiredPermissions: capability.requiredPermissions || [],
      reversible: capability.reversible !== false,
      requiresApproval: capability.requiresApproval || false,
      timeoutMs: capability.timeoutMs || 60000,
      retryPolicy: capability.retryPolicy || { maxRetries: 0, backoffMs: 0 },
      verificationProcedure: capability.verificationProcedure || 'none',
    });
    return this;
  }

  get(id) {
    return this.capabilities.get(id);
  }

  has(id) {
    return this.capabilities.has(id);
  }

  list() {
    return Array.from(this.capabilities.values());
  }

  byRisk(risk) {
    return this.list().filter(c => c.riskLevel === risk);
  }

  registerDefaults() {
    const defaults = [
      { id: 'health.read', description: 'Read HYDI health endpoints', riskLevel: 'READ', environment: 'local' },
      { id: 'health.recover', description: 'Recover a safe local service', riskLevel: 'LOW', environment: 'local' },
      { id: 'test.run', description: 'Run unit/integration tests', riskLevel: 'LOW', environment: 'local' },
      { id: 'build.run', description: 'Run typecheck/build', riskLevel: 'LOW', environment: 'local' },
      { id: 'git.local', description: 'Local git branch/file operations', riskLevel: 'LOW', environment: 'local' },
      { id: 'docker.local', description: 'Local Docker operations', riskLevel: 'MEDIUM', environment: 'local' },
      { id: 'wsl.local', description: 'Local WSL operations', riskLevel: 'MEDIUM', environment: 'local' },
      { id: 'database.local', description: 'Local database operations', riskLevel: 'MEDIUM', environment: 'local' },
      { id: 'deploy.production', description: 'Deploy to production', riskLevel: 'CRITICAL', environment: 'production', requiresApproval: true, allowedTargets: ['vercel'] },
      { id: 'credential.production', description: 'Modify production credentials', riskLevel: 'CRITICAL', environment: 'production', requiresApproval: true },
      { id: 'financial.transaction', description: 'Perform a financial transaction', riskLevel: 'CRITICAL', environment: 'production', requiresApproval: true },
      { id: 'database.destructive', description: 'Drop/truncate production data', riskLevel: 'CRITICAL', environment: 'production', requiresApproval: true, reversible: false },
    ];
    for (const c of defaults) this.register(c);
  }
}

module.exports = { CapabilityRegistry, RISK_LEVELS };
