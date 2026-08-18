const fs = require('fs');
const path = require('path');
const { loadManifest } = require('../../../packages/application-manifest/src/index');
const { ApplicationRegistry } = require('../../../packages/application-registry/src/index');
const { CapabilityPolicy } = require('../../../packages/capability-policy/src/index');
const { DependencyGraph } = require('../../../packages/dependency-graph/src/index');
const { LIFECYCLE_TYPES } = require('../../../packages/application-manifest/src/lifecycle');
const { parseVersion } = require('../../../packages/application-upgrades/src/index');
const { getRuntimeInventory } = require(path.resolve(__dirname, '..', '..', '..', '..', 'lib', 'platform-diagnostics'));

function isNamespaced(eventType) {
  return typeof eventType === 'string' && eventType.includes('.');
}

function isDangerous(eventType) {
  const lower = eventType.toLowerCase();
  const danger = ['delete.everything', 'wipe', 'drop', 'purge.all', 'destroy'];
  return danger.some(d => lower.includes(d));
}

class Certifier {
  constructor(options = {}) {
    this.policy = options.policy || null;
    this.registry = options.registry || new ApplicationRegistry({ autoLoad: true });
    this.requireTests = options.requireTests !== false;
    this.requireDocs = options.requireDocs !== false;
    this.requirePolicy = options.requirePolicy !== false;
  }

  async _loadManifest(appDir) {
    const manifestPath = path.join(appDir, 'manifest.json');
    const loaded = loadManifest(manifestPath);
    if (!loaded.ok) {
      return { manifest: null, errors: [loaded.error] };
    }
    return { manifest: loaded.manifest, errors: [] };
  }

  _checkManifest(manifest) {
    const errors = [];
    if (!manifest.name || typeof manifest.name !== 'string') errors.push('manifest missing name');
    if (!parseVersion(manifest.version)) errors.push(`invalid semantic version: ${manifest.version}`);
    if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) errors.push('manifest must declare at least one capability');
    if (!Array.isArray(manifest.eventsProduced)) errors.push('eventsProduced must be an array');
    if (!Array.isArray(manifest.eventsConsumed)) errors.push('eventsConsumed must be an array');
    if (!Array.isArray(manifest.providers) || manifest.providers.length === 0) errors.push('manifest must declare at least one provider');
    if (!manifest.dependencies || typeof manifest.dependencies !== 'object') errors.push('manifest must declare dependencies');
    if (manifest.deprecated) errors.push('deprecated applications cannot be certified');
    return { ok: errors.length === 0, errors };
  }

  _checkCapabilities(manifest) {
    const errors = [];
    for (const cap of manifest.capabilities || []) {
      if (typeof cap !== 'string' || cap.trim() === '') errors.push(`invalid capability: ${cap}`);
    }
    return { ok: errors.length === 0, errors };
  }

  _checkDependencies(manifest, appDir) {
    const errors = [];
    if (!fs.existsSync(path.join(appDir, 'src', 'index.js'))) errors.push('missing src/index.js');
    if (this.requireTests && !fs.existsSync(path.join(appDir, 'tests'))) errors.push('missing tests directory');
    if (this.requireDocs && !fs.existsSync(path.join(appDir, 'README.md'))) errors.push('missing README.md');
    for (const svc of manifest.dependencies?.services || []) {
      if (typeof svc !== 'string' || svc.trim() === '') errors.push(`invalid service dependency: ${svc}`);
    }
    for (const pkg of manifest.dependencies?.packages || []) {
      if (typeof pkg !== 'string' || pkg.trim() === '') errors.push(`invalid package dependency: ${pkg}`);
    }
    return { ok: errors.length === 0, errors };
  }

  _checkLifecycle(manifest) {
    const errors = [];
    const app = this.registry.get(manifest.name);
    if (!app) errors.push(`application ${manifest.name} not registered`);
    if (app && !['created', 'registered', 'active', 'degraded'].includes(app.status)) {
      errors.push(`application lifecycle state ${app.status} is not certifiable`);
    }
    return { ok: errors.length === 0, errors };
  }

  _checkEvents(manifest) {
    const errors = [];
    for (const ev of [...(manifest.eventsProduced || []), ...(manifest.eventsConsumed || [])]) {
      if (!isNamespaced(ev)) errors.push(`event ${ev} must be dot-namespaced`);
      if (isDangerous(ev)) errors.push(`event ${ev} is not allowed`);
    }
    return { ok: errors.length === 0, errors };
  }

  async _checkDiagnostics(manifest) {
    const errors = [];
    let inventory;
    try {
      inventory = await getRuntimeInventory();
    } catch (err) {
      return { ok: false, errors: [err instanceof Error ? err.message : 'diagnostics failed'] };
    }
    if (!Array.isArray(inventory.applications) || inventory.applications.length === 0) {
      errors.push('diagnostics did not return applications');
      return { ok: false, errors };
    }
    const found = inventory.applications.find(a => a.name.toLowerCase() === (manifest.name || '').toLowerCase());
    if (!found) errors.push(`application ${manifest.name} not present in diagnostics inventory`);
    const health = (inventory.governance?.applicationHealth || []).find(a => a.name.toLowerCase() === (manifest.name || '').toLowerCase());
    if (!health) errors.push(`application ${manifest.name} not in governance health`);
    if (health && !health.policyValid) errors.push(`application ${manifest.name} failed policy validation`);
    return { ok: errors.length === 0, errors };
  }

  _checkPolicy(manifest) {
    if (!this.requirePolicy) return { ok: true, errors: [] };
    if (!this.policy) {
      return { ok: false, errors: ['no capability policy configured'] };
    }
    return this.policy.validate(manifest);
  }

  _checkGraph(manifest, allManifests) {
    const graph = new DependencyGraph({ manifests: [...allManifests, manifest] });
    const deps = graph.getDependencies(manifest.name);
    if (deps.length === 0) return { ok: false, errors: ['application has no declared dependencies in graph'] };
    return { ok: true, errors: [] };
  }

  async certify(appNameOrDir) {
    const appDir = this._resolveAppDir(appNameOrDir);
    if (!appDir) {
      return { ok: false, report: { name: appNameOrDir, error: 'application not found' } };
    }

    const { manifest, errors: loadErrors } = await this._loadManifest(appDir);
    if (!manifest) {
      return { ok: false, report: { name: appNameOrDir, error: loadErrors[0] } };
    }

    const allManifests = this.registry.list();

    const checks = {
      manifest: this._checkManifest(manifest),
      capabilities: this._checkCapabilities(manifest),
      dependencies: this._checkDependencies(manifest, appDir),
      lifecycle: this._checkLifecycle(manifest),
      events: this._checkEvents(manifest),
      diagnostics: await this._checkDiagnostics(manifest),
      policy: this._checkPolicy(manifest),
      graph: this._checkGraph(manifest, allManifests)
    };

    const report = {
      name: manifest.name,
      version: manifest.version,
      appDir,
      manifest,
      checks,
      certified: Object.values(checks).every(c => c.ok)
    };

    return { ok: report.certified, report };
  }

  _resolveAppDir(appNameOrDir) {
    if (fs.existsSync(appNameOrDir) && fs.statSync(appNameOrDir).isDirectory()) return appNameOrDir;
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const inApplications = path.join(repoRoot, 'protoforge-applications', appNameOrDir.toLowerCase().replace(/\s+/g, '-'));
    if (fs.existsSync(inApplications)) return inApplications;
    const inSwitchboard = path.join(repoRoot, 'switchboard');
    if (appNameOrDir.toLowerCase() === 'switchboard' && fs.existsSync(inSwitchboard)) return inSwitchboard;
    return null;
  }
}

module.exports = { Certifier, isNamespaced, isDangerous };
