/**
 * HEIDI Operational Decision Engine — Autonomy Levels and Authorization
 */

const AUTONOMY_LEVELS = Object.freeze([
  'L0_OBSERVE',
  'L1_DIAGNOSE',
  'L2_RECOMMEND',
  'L3_AUTO_RECOVER',
  'L4_MULTI_STEP_RECOVERY',
  'L5_HUMAN_APPROVAL',
  'FORBIDDEN',
]);

const DEFAULT_LEVELS = Object.freeze({
  'health.read': 'L0_OBSERVE',
  'diagnostic.collect': 'L1_DIAGNOSE',
  'diagnostic.classify': 'L1_DIAGNOSE',
  'test.run': 'L1_DIAGNOSE',
  'build.run': 'L1_DIAGNOSE',
  'health.recover': 'L3_AUTO_RECOVER',
  'docker.local': 'L3_AUTO_RECOVER',
  'wsl.local': 'L3_AUTO_RECOVER',
  'database.local': 'L5_HUMAN_APPROVAL',
  'deploy.production': 'L5_HUMAN_APPROVAL',
  'credential.production': 'L5_HUMAN_APPROVAL',
  'financial.transaction': 'L5_HUMAN_APPROVAL',
  'database.destructive': 'FORBIDDEN',
  'volume.delete': 'FORBIDDEN',
  'security.policy.modify': 'FORBIDDEN',
});

class AutonomyPolicy {
  constructor(levels = DEFAULT_LEVELS) {
    this.levels = { ...DEFAULT_LEVELS, ...levels };
    this.allowedAuto = new Set(['L0_OBSERVE', 'L1_DIAGNOSE', 'L2_RECOMMEND', 'L3_AUTO_RECOVER', 'L4_MULTI_STEP_RECOVERY']);
  }

  levelFor(capabilityId) {
    if (this.levels[capabilityId]) return this.levels[capabilityId];
    // Unknown capabilities must not be assumed safe.
    return 'FORBIDDEN';
  }

  canExecute(capabilityId, approved = false) {
    const level = this.levelFor(capabilityId);
    if (level === 'FORBIDDEN') return { ok: false, reason: 'forbidden_capability' };
    if (this.allowedAuto.has(level)) return { ok: true, level };
    if (approved) return { ok: true, level, reason: 'human_approved' };
    return { ok: false, level, reason: 'requires_approval' };
  }

  isAllowed(capabilityId) {
    return this.canExecute(capabilityId).ok;
  }
}

module.exports = { AutonomyPolicy, AUTONOMY_LEVELS, DEFAULT_LEVELS };
