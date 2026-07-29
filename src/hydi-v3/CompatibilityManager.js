'use strict';

class CompatibilityManager {
  constructor(config = {}) {
    this.registry = config.registry || null;
    this.rules = config.rules || [];
  }

  _parse(version) {
    const parts = String(version).split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  }

  _compare(a, b) {
    for (const key of ['major', 'minor', 'patch']) {
      if (a[key] > b[key]) return 1;
      if (a[key] < b[key]) return -1;
    }
    return 0;
  }

  _satisfies(required, actual) {
    const req = this._parse(required);
    const act = this._parse(actual);
    if (act.major !== req.major) return false;
    return this._compare(act, req) >= 0;
  }

  validate(componentName, targetVersion, requiredDependencies = []) {
    const reasons = [];
    if (!this.registry) {
      reasons.push('no_registry');
      return { status: 'blocked', reasons };
    }

    const c = this.registry.get(componentName);
    if (!c) {
      reasons.push('component_not_registered');
      return { status: 'blocked', reasons };
    }

    const current = this._parse(c.version);
    const target = this._parse(targetVersion);
    if (target.major < current.major) {
      reasons.push('downgrade_across_major');
      return { status: 'blocked', reasons };
    }

    let status = 'compatible';
    if (target.major > current.major) {
      status = 'warning';
      reasons.push('major_version_bump');
    } else if (target.minor > current.minor) {
      status = 'warning';
      reasons.push('minor_version_bump');
    }

    for (const dep of requiredDependencies) {
      const installed = this.registry.get(dep.name);
      if (!installed) {
        reasons.push(`missing_dependency:${dep.name}`);
        status = 'blocked';
        continue;
      }
      if (dep.minVersion && !this._satisfies(dep.minVersion, installed.version)) {
        reasons.push(`incompatible_dependency:${dep.name} needs ${dep.minVersion}, has ${installed.version}`);
        status = 'blocked';
      }
    }

    for (const rule of this.rules) {
      if (rule.component === componentName && rule.blocked && rule.blocked.includes(targetVersion)) {
        reasons.push(rule.reason || 'blocked_by_rule');
        status = 'blocked';
      }
    }

    return { status, reasons };
  }

  checkGraph(targets) {
    const results = targets.map((t) => ({ ...this.validate(t.name, t.version, t.dependencies), name: t.name, version: t.version }));
    const blocked = results.some((r) => r.status === 'blocked');
    const warnings = results.some((r) => r.status === 'warning');
    const overall = blocked ? 'blocked' : (warnings ? 'warning' : 'compatible');
    return { overall, results };
  }
}

module.exports = CompatibilityManager;
