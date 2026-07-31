'use strict';

class CapabilityInstaller {
  constructor(config = {}) {
    this.registry = config.registry || null;
    this.publisherRegistry = config.publisherRegistry || null;
    this.signatureVerifier = config.signatureVerifier || null;
    this.dependencyResolver = config.dependencyResolver || null;
    this.sandbox = config.sandbox || null;
    this.snapshotManager = config.snapshotManager || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.allowUnsigned = config.allowUnsigned === true;
    this.logger = config.logger || console;
  }

  async install(capability, options = {}) {
    const report = { id: capability.id, success: false, quarantined: false, steps: [] };
    const reg = this.registry;
    if (!reg) return { ...report, error: 'no_registry' };

    const allowUnsigned = options.allowUnsigned !== undefined ? options.allowUnsigned : this.allowUnsigned;

    // dependency resolution
    const installed = new Map(reg.list().map((c) => [c.id, c]));
    const resolved = this.dependencyResolver ? this.dependencyResolver.resolve(capability, installed) : { success: true, order: [capability] };
    if (!resolved.success) {
      report.error = 'dependency_resolution_failed';
      report.dependencyReport = resolved;
      return report;
    }

    // pre-install snapshot
    let snapshotHash = null;
    if (this.snapshotManager) {
      const snap = await this.snapshotManager.create(`pre-install-${capability.id}`);
      if (snap.success) snapshotHash = snap.hash;
      report.steps.push({ step: 'snapshot', hash: snapshotHash });
    }

    // signature verification
    const verify = this.signatureVerifier ? this.signatureVerifier.verify(capability, options) : { valid: true };
    if (!verify.valid) {
      if (allowUnsigned) {
        report.quarantined = true;
        report.steps.push({ step: 'signature', status: 'quarantined', reasons: verify.reasons });
        // still attempt install in quarantine
      } else {
        report.error = 'signature_verification_failed';
        report.reasons = verify.reasons;
        await this._rollback(report, snapshotHash);
        return report;
      }
    } else {
      report.steps.push({ step: 'signature', status: 'verified' });
    }

    // install order
    for (const cap of resolved.order) {
      if (!this._supportsPlatform(cap)) {
        report.error = 'unsupported_platform';
        report.failedCapability = cap.id;
        await this._rollback(report, snapshotHash);
        return report;
      }

      reg.register(cap);
      reg.setState(cap.id, report.quarantined ? 'quarantined' : 'installed');
      if (this.sandbox) this.sandbox.registerCapability(cap);
      if (this.lifecycleRegistry) this.lifecycleRegistry.register({ name: cap.id, version: cap.version, category: 'capability', capabilities: [cap.type] });
      report.steps.push({ step: 'install', id: cap.id, version: cap.version, state: report.quarantined ? 'quarantined' : 'installed' });
    }

    const installation = {
      id: `${capability.id}@${capability.version}`,
      at: Date.now(),
      capabilities: resolved.order.map((c) => c.id),
      snapshotHash,
      quarantined: report.quarantined,
    };
    reg.recordInstallation(capability.id, installation);

    report.success = true;
    report.installation = installation;
    return report;
  }

  async uninstall(capabilityId) {
    const reg = this.registry;
    if (!reg) return { success: false, error: 'no_registry' };
    const cap = reg.get(capabilityId);
    if (!cap) return { success: false, error: 'not_installed' };
    reg.remove(capabilityId);
    if (this.sandbox) this.sandbox.revoke(capabilityId);
    return { success: true, id: capabilityId, version: cap.version };
  }

  async rollback(installationId, registry) {
    const reg = registry || this.registry;
    const inst = reg ? reg.getInstallation(installationId) : null;
    if (!inst && reg) {
      const id = installationId.split('@')[0];
      const cap = reg.get(id);
      if (cap && cap.installedAt) {
        // remove by id
        await this.uninstall(id);
        return { success: true, action: 'uninstall' };
      }
    }
    if (!inst) return { success: false, error: 'installation_not_found' };
    for (const capId of inst.capabilities) {
      reg.setState(capId, 'removed');
      reg.remove(capId);
      if (this.sandbox) this.sandbox.revoke(capId);
    }
    if (this.snapshotManager && inst.snapshotHash) {
      await this.snapshotManager.restore(inst.snapshotHash);
    }
    return { success: true, action: 'rollback', installationId, restoredSnapshot: inst.snapshotHash };
  }

  async _rollback(report, snapshotHash) {
    if (this.snapshotManager && snapshotHash) {
      await this.snapshotManager.restore(snapshotHash);
      report.rollback = 'snapshot_restored';
    } else {
      report.rollback = 'no_snapshot';
    }
  }

  _supportsPlatform(cap) {
    const platforms = cap.supportedPlatforms || [];
    if (platforms.length === 0) return true;
    return platforms.includes('all') || platforms.includes(process.platform);
  }
}

module.exports = CapabilityInstaller;
