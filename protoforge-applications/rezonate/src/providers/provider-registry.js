class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(name, provider) {
    if (!name || typeof name !== 'string') throw new Error('provider name is required');
    if (!provider || typeof provider.generate !== 'function') throw new Error('provider must implement generate()');
    this.providers.set(name, provider);
    return this;
  }

  resolve(name) {
    return this.providers.get(name) || null;
  }

  list() {
    return [...this.providers.keys()];
  }

  async health(name) {
    const provider = this.resolve(name);
    if (!provider) return { ok: false, available: false, reason: 'provider not found' };
    return provider.health();
  }
}

module.exports = { ProviderRegistry };
