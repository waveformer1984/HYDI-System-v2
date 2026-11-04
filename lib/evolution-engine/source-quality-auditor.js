'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Read-only repo hygiene checks (no eslint invocation — bounded file scans).
 */
class SourceQualityAuditor {
  /**
   * @param {{ repoRoot?: string }} [opts]
   */
  constructor(opts = {}) {
    this.repoRoot = opts.repoRoot || process.cwd();
  }

  audit() {
    const findings = [];
    const pkgPath = path.join(this.repoRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      findings.push({
        severity: 'high',
        subsystem: 'repo',
        code: 'missing_package_json',
        message: 'package.json not found at repo root.',
        remediation: 'Run from HYDI repository root.',
      });
      return { findings };
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts?.typecheck) {
      findings.push({
        severity: 'moderate',
        subsystem: 'repo',
        code: 'missing_typecheck_script',
        message: 'No npm run typecheck script — TS regressions may slip through.',
        remediation: 'Ensure package.json scripts.typecheck runs tsc --noEmit.',
      });
    }
    if (!pkg.scripts?.test) {
      findings.push({
        severity: 'high',
        subsystem: 'repo',
        code: 'missing_test_script',
        message: 'No npm test script.',
        remediation: 'Wire Jest via npm test.',
      });
    }
    const agents = path.join(this.repoRoot, 'AGENTS.md');
    if (!fs.existsSync(agents)) {
      findings.push({
        severity: 'info',
        subsystem: 'documentation',
        code: 'missing_agents_md',
        message: 'AGENTS.md missing — agent onboarding guidance absent.',
        remediation: 'Restore AGENTS.md from clean-main.',
      });
    }
    const contrib = path.join(this.repoRoot, 'CONTRIBUTING.md');
    if (!fs.existsSync(contrib)) {
      findings.push({
        severity: 'info',
        subsystem: 'documentation',
        code: 'missing_contributing',
        message: 'CONTRIBUTING.md missing.',
        remediation: 'Add contributor checklist.',
      });
    }
    const apiDir = path.join(this.repoRoot, 'api');
    let apiFiles = 0;
    if (fs.existsSync(apiDir)) {
      apiFiles = this._countJs(apiDir);
    }
    if (apiFiles === 0) {
      findings.push({
        severity: 'moderate',
        subsystem: 'api',
        code: 'api_tree_empty',
        message: 'No api/*.js routes detected under api/.',
        evidence: { apiDir },
        remediation: 'Verify checkout path (HYDI_REPO_ROOT).',
      });
    }
    return { findings, meta: { api_route_files: apiFiles } };
  }

  _countJs(dir) {
    let n = 0;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) n += this._countJs(p);
      else if (ent.name.endsWith('.js')) n += 1;
    }
    return n;
  }
}

module.exports = { SourceQualityAuditor };
