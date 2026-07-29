'use strict';

const crypto = require('crypto');

class SignatureVerifier {
  constructor(config = {}) {
    this.publisherRegistry = config.publisherRegistry || null;
    this.logger = config.logger || console;
  }

  computeDigest(capability) {
    const payload = {
      id: capability.id,
      version: capability.version,
      type: capability.type,
      publisher: capability.publisher,
      dependencies: capability.dependencies,
      requiredPermissions: capability.requiredPermissions,
      requiredHYDIVersion: capability.requiredHYDIVersion,
    };
    const text = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  verify(capability, options = {}) {
    const reasons = [];
    let valid = true;

    if (!capability.signature) {
      valid = false;
      reasons.push('missing_signature');
    }

    const expected = this.computeDigest(capability);
    if (capability.digest && capability.digest !== expected) {
      valid = false;
      reasons.push('digest_mismatch');
    }

    if (this.publisherRegistry) {
      const trust = this.publisherRegistry.getTrustLevel(capability.publisher);
      if (trust === 'untrusted') {
        valid = false;
        reasons.push('publisher_untrusted');
      } else if (this.publisherRegistry.isRevoked(capability.publisher)) {
        valid = false;
        reasons.push('publisher_revoked');
      }
    }

    if (options.requireTrusted && (!this.publisherRegistry || this.publisherRegistry.getTrustLevel(capability.publisher) !== 'official')) {
      valid = false;
      reasons.push('not_official');
    }

    return { valid, reasons, digest: expected };
  }

  sign(capability, privateKey) {
    const digest = this.computeDigest(capability);
    const signature = `sig:${privateKey}:${digest.slice(0, 16)}`;
    return { digest, signature };
  }
}

module.exports = SignatureVerifier;
