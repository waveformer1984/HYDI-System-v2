'use strict';

const fs = require('fs').promises;

class DeploymentManifest {
  constructor(config = {}) {
    this.manifest = config.manifest || {};
  }

  static fromRegistry(registry, overrides = {}) {
    const components = registry ? registry.list() : [];
    return new DeploymentManifest({
      manifest: {
        runtimeVersions: overrides.runtimeVersions || {},
        services: overrides.services || [],
        ports: overrides.ports || {},
        models: overrides.models || [],
        databases: overrides.databases || [],
        environment: overrides.environment || {},
        agents: overrides.agents || {},
        plugins: overrides.plugins || [],
        configuration: overrides.configuration || {},
        components,
      },
    });
  }

  static async fromFile(filePath) {
    const text = await fs.readFile(filePath, 'utf8');
    return new DeploymentManifest({ manifest: JSON.parse(text) });
  }

  async write(filePath) {
    await fs.writeFile(filePath, this.toJSON(), 'utf8');
  }

  validate() {
    const errors = [];
    const m = this.manifest;
    if (!m.components || !Array.isArray(m.components)) errors.push('missing components');
    if (!m.runtimeVersions) errors.push('missing runtimeVersions');
    if (!m.services) errors.push('missing services');
    if (!m.ports) errors.push('missing ports');
    for (const c of (m.components || [])) {
      if (!c.name || !c.version) errors.push(`component missing name/version: ${JSON.stringify(c)}`);
    }
    return { valid: errors.length === 0, errors };
  }

  toJSON() {
    return JSON.stringify(this.manifest, null, 2);
  }

  async bootstrap(registry) {
    for (const c of (this.manifest.components || [])) {
      registry.register(c);
    }
    return { bootstrapped: (this.manifest.components || []).length };
  }

  async verify(registry) {
    const present = registry.list();
    const expected = (this.manifest.components || []);
    const missing = expected.filter((e) => !present.some((p) => p.name === e.name && p.version === e.version));
    const extra = present.filter((p) => !expected.some((e) => e.name === p.name));
    return { ok: missing.length === 0 && extra.length === 0, missing, extra };
  }

  export() {
    return { ...this.manifest, exportedAt: Date.now() };
  }
}

module.exports = DeploymentManifest;
