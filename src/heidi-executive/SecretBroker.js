/**
 * HEIDI Operational Control Plane — Secret Broker
 * Tools receive credential references, never raw credentials.
 */

class SecretBroker {
  constructor(resolver) {
    this.resolver = resolver || null;
    this.usageLog = [];
  }

  registerResolver(resolver) {
    this.resolver = resolver;
    return this;
  }

  resolve(ref) {
    if (typeof ref !== 'string' || ref.trim() === '') {
      throw new Error('Secret reference must be a non-empty string');
    }
    if (ref.startsWith('sk_') || ref.startsWith('whsec_') || ref.startsWith('sb_secret_')) {
      throw new Error('Secret broker rejects raw secret values as references');
    }
    if (!this.resolver) {
      throw new Error('No secret resolver registered');
    }
    this.logUsage(ref);
    return this.resolver(ref);
  }

  logUsage(ref) {
    this.usageLog.push({ ref, at: Date.now(), actor: 'heidi' });
  }

  getUsageLog() {
    return this.usageLog.map(u => ({ ...u }));
  }

  redact(input) {
    if (typeof input === 'string') {
      return input
        .replace(/\b(sk_live_|sk_test_|whsec_|sb_secret_|sb_publishable_)[A-Za-z0-9_]{10,}/g, '[REDACTED]')
        .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{0,}\.[A-Za-z0-9_-]{0,})\b/g, '[REDACTED_JWT]');
    }
    if (input && typeof input === 'object') {
      const redacted = {};
      for (const [k, v] of Object.entries(input)) {
        const sensitive = /secret|key|token|password|credential/i.test(k);
        redacted[k] = sensitive && typeof v === 'string' ? '[REDACTED]' : this.redact(v);
      }
      return redacted;
    }
    if (Array.isArray(input)) {
      return input.map(i => this.redact(i));
    }
    return input;
  }
}

module.exports = { SecretBroker };
