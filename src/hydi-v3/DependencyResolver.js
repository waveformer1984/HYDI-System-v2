'use strict';

class DependencyResolver {
  constructor(config = {}) {
    this.repository = config.repository || null;
    this.hydiVersion = config.hydiVersion || '99.99.99';
  }

  _parse(version) {
    const parts = String(version).split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  }

  _matchesRange(version, range) {
    const v = this._parse(version);
    if (range.startsWith('>=')) {
      const r = this._parse(range.slice(2));
      return v.major > r.major || (v.major === r.major && (v.minor > r.minor || (v.minor === r.minor && v.patch >= r.patch)));
    }
    if (range.startsWith('^')) {
      const r = this._parse(range.slice(1));
      return v.major === r.major && (v.minor > r.minor || (v.minor === r.minor && v.patch >= r.patch));
    }
    const r = this._parse(range);
    return v.major === r.major && v.minor === r.minor && v.patch === r.patch;
  }

  resolve(capability, installed = new Map()) {
    const order = [];
    const seen = new Set();
    const conflicts = [];
    const missing = [];
    const circular = [];
    const path = [];

    const visit = (id) => {
      if (path.includes(id)) {
        circular.push([...path, id]);
        return;
      }
      if (seen.has(id)) return;
      const cap = installed.has(id) ? installed.get(id) : (this.repository ? this.repository.getCapability(id) : null);
      if (!cap) {
        missing.push(id);
        return;
      }
      if (cap.requiredHYDIVersion && !this._matchesRange(this.hydiVersion, cap.requiredHYDIVersion)) {
        conflicts.push({ id, reason: 'incompatible_hydi_version', required: cap.requiredHYDIVersion, current: this.hydiVersion });
        return;
      }
      path.push(id);
      for (const dep of cap.dependencies || []) {
        const depId = typeof dep === 'string' ? dep : dep.id;
        const depRange = typeof dep === 'string' ? '*' : (dep.version || '*');
        const depCap = this.repository ? this.repository.getCapability(depId) : null;
        if (!depCap) {
          missing.push(depId);
          continue;
        }
        if (installed.has(depId) && !this._matchesRange(installed.get(depId).version, depRange)) {
          conflicts.push({ id: depId, reason: 'version_conflict', required: depRange, installed: installed.get(depId).version });
          continue;
        }
        visit(depId);
      }
      path.pop();
      seen.add(id);
      order.push(cap);
    };

    visit(capability.id || capability);
    const success = missing.length === 0 && conflicts.length === 0 && circular.length === 0;
    return { success, order, missing, conflicts, circular };
  }
}

module.exports = DependencyResolver;
