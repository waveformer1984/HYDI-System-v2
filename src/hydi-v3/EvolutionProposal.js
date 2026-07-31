'use strict';

class EvolutionProposal {
  constructor({ title, change, reason, benefit, affected, risk = 'low', rollback = '', approvalRequired = false }) {
    this.title = title || 'Untitled proposal';
    this.change = change || {};
    this.reason = reason || '';
    this.benefit = benefit || '';
    this.affected = affected || [];
    this.risk = risk;
    this.rollback = rollback;
    this.approvalRequired = approvalRequired;
    this.approved = false;
    this.rejected = false;
    this.at = Date.now();
  }

  static fromUpgrade({ name, fromVersion, toVersion, benefit, risk = 'low' }) {
    return new EvolutionProposal({
      title: `Upgrade ${name} from ${fromVersion} to ${toVersion}`,
      change: { name, from: fromVersion, to: toVersion },
      reason: 'Version bump discovered by lifecycle scan',
      benefit: benefit || `Maintain latest ${name} capabilities`,
      affected: [name],
      risk,
      rollback: 'Restore pre-upgrade snapshot',
      approvalRequired: risk === 'high' || risk === 'medium',
    });
  }

  approve() {
    if (this.rejected) return false;
    this.approved = true;
    return true;
  }

  reject() {
    if (this.approved) return false;
    this.rejected = true;
    return true;
  }

  toJSON() {
    return {
      title: this.title,
      change: this.change,
      reason: this.reason,
      benefit: this.benefit,
      affected: this.affected,
      risk: this.risk,
      rollback: this.rollback,
      approvalRequired: this.approvalRequired,
      approved: this.approved,
      rejected: this.rejected,
      at: this.at,
    };
  }
}

module.exports = EvolutionProposal;
