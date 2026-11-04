'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read-only dependency health (no npm audit network call in hot path).
 */
class DependencyAuditor {
  constructor(opts = {}) {
    this.repoRoot = opts.repoRoot || process.cwd();
  }

  audit() {
    const findings = [];
    const lock = path.join(this.repoRoot, 'package-lock.json');
    const pkgPath = path.join(this.repoRoot, 'package.json');
    if (!fs.existsSync(lock)) {
      findings.push({
        severity: 'moderate',
        subsystem: 'dependencies',
        code: 'missing_lockfile',
        message: 'package-lock.json missing — non-reproducible installs.',
        remediation: 'Run npm install and commit lockfile.',
      });
    }
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const engines = pkg.engines?.node;
      if (!engines) {
        findings.push({
          severity: 'info',
          subsystem: 'dependencies',
          code: 'engines_not_pinned',
          message: 'package.json engines.node not declared.',
          remediation: 'Document Node >= 22 in engines field.',
        });
      }
    }
    return { findings, npm_audit: 'not_measured' };
  }
}

module.exports = { DependencyAuditor };
