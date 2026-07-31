'use strict';

const crypto = require('crypto');

/**
 * Deterministically serializes a value with object keys sorted at every
 * level of nesting (not just the top). A JSON.stringify(obj, arrayReplacer)
 * only allowlists property *names*, and that allowlist applies recursively
 * to every nested object -- so it silently strips any nested object whose
 * own keys are not also in the top-level allowlist. That previously made
 * capability.requiredPermissions/dependencies invisible to the digest.
 */
function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

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
    const text = canonicalStringify(payload);
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Generates a real Ed25519 keypair (PEM-encoded). The private key is for
   * the publisher to keep and sign with; only the public key should ever be
   * registered via PublisherRegistry.
   */
  static generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    };
  }

  /**
   * Signs a capability's digest with the publisher's Ed25519 private key
   * (PEM-encoded). The private key is used to produce the signature and
   * never appears in the output -- verify() checks the signature
   * cryptographically against the publisher's registered public key.
   */
  sign(capability, privateKeyPem) {
    const digest = this.computeDigest(capability);
    const signature = crypto.sign(null, Buffer.from(digest, 'utf8'), privateKeyPem).toString('base64');
    return { digest, signature };
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

    let publisherRecord = null;
    if (this.publisherRegistry) {
      const trust = this.publisherRegistry.getTrustLevel(capability.publisher);
      if (trust === 'untrusted') {
        valid = false;
        reasons.push('publisher_untrusted');
      } else if (this.publisherRegistry.isRevoked(capability.publisher)) {
        valid = false;
        reasons.push('publisher_revoked');
      }
      publisherRecord = this.publisherRegistry.get(capability.publisher);
    }

    // Cryptographic authenticity: the signature must actually verify against
    // the publisher's registered public key. A capability whose publisher has
    // no known public key on file cannot have its authenticity established,
    // so this fails closed rather than trusting an unverifiable claim.
    if (capability.signature) {
      if (!publisherRecord || !publisherRecord.publicKey) {
        valid = false;
        reasons.push('publisher_key_unknown');
      } else {
        try {
          const sigBuffer = Buffer.from(capability.signature, 'base64');
          const cryptoValid = crypto.verify(null, Buffer.from(expected, 'utf8'), publisherRecord.publicKey, sigBuffer);
          if (!cryptoValid) {
            valid = false;
            reasons.push('signature_invalid');
          }
        } catch (err) {
          valid = false;
          reasons.push('signature_malformed');
        }
      }
    }

    if (options.requireTrusted && (!this.publisherRegistry || this.publisherRegistry.getTrustLevel(capability.publisher) !== 'official')) {
      valid = false;
      reasons.push('not_official');
    }

    return { valid, reasons, digest: expected };
  }
}

module.exports = SignatureVerifier;
