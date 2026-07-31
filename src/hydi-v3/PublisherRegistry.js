'use strict';

const TRUST_LEVELS = ['official', 'verified', 'enterprise', 'community', 'development', 'untrusted'];

class PublisherRegistry {
  constructor(config = {}) {
    this.publishers = new Map();
    this.revoked = new Set();
    this.logger = config.logger || console;
  }

  register({ id, name, publicKey, status = 'community', reputation = 0, packages = [] }) {
    const entry = {
      id,
      name: name || id,
      publicKey: publicKey || null,
      status,
      reputation,
      packages: packages || [],
      registeredAt: Date.now(),
    };
    this.publishers.set(id, entry);
    return entry;
  }

  get(id) {
    if (this.revoked.has(id)) return null;
    return this.publishers.get(id) || null;
  }

  list() {
    return Array.from(this.publishers.values()).filter((p) => !this.revoked.has(p.id));
  }

  revoke(id) {
    if (this.publishers.has(id)) {
      this.revoked.add(id);
      return true;
    }
    return false;
  }

  isRevoked(id) {
    return this.revoked.has(id);
  }

  getTrustLevel(id) {
    if (this.revoked.has(id)) return 'untrusted';
    const p = this.publishers.get(id);
    if (!p) return 'untrusted';
    return TRUST_LEVELS.includes(p.status) ? p.status : 'untrusted';
  }

  addPackage(id, capabilityId) {
    const p = this.publishers.get(id);
    if (!p) return false;
    p.packages.push(capabilityId);
    return true;
  }

  recordReputation(id, delta) {
    const p = this.publishers.get(id);
    if (p) p.reputation += delta;
    return p ? p.reputation : 0;
  }
}

module.exports = PublisherRegistry;
