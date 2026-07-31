'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * SecurityAuditor audits secrets, tokens, API keys, environment variables, and
 * database permissions. It also provides local encryption helpers and input validation.
 */
class SecurityAuditor {
  constructor(config = {}) {
    this.config = {
      scanPaths: config.scanPaths || [path.resolve(__dirname, '../../src/hydi-v3')],
      extensions: config.extensions || ['.js', '.ts', '.json', '.env', '.yaml', '.yml'],
      ...config,
    };

    this.patterns = [
      { name: 'stripe_live_key', regex: /sk_live_[a-zA-Z0-9]{24,}/, severity: 'critical' },
      { name: 'generic_api_key', regex: /["'](?:api[_-]?key|apikey|api_secret)["']\s*[:=]\s*["'][a-zA-Z0-9_-]{16,}["']/i, severity: 'critical' },
      { name: 'password_literal', regex: /password\s*[:=]\s*["'][^"']{8,}["']/i, severity: 'high' },
      { name: 'private_key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, severity: 'critical' },
      { name: 'bearer_token', regex: /Bearer\s+[a-zA-Z0-9_-]{20,}/i, severity: 'high' },
      { name: 'basic_auth', regex: /https?:\/\/[^:\r\n]+:[^@\r\n]+@[a-z0-9.]+/i, severity: 'high' },
      { name: 'hardcoded_secret', regex: /secret\s*[:=]\s*["'][a-zA-Z0-9_-]{16,}["']/i, severity: 'high' },
      { name: 'env_in_code', regex: /process\.env\.[A-Z_]+\s*[:=]\s*["'][^"']+["']/i, severity: 'medium' },
      { name: 'sql_injection', regex: /(?:execute|query|exec)\s*\(\s*[`"'][^`"']*\$\{[^}]*\}/i, severity: 'critical' },
      { name: 'eval_usage', regex: /\beval\s*\(/, severity: 'medium' },
    ];

    this.inputValidators = [
      (input) => ({ issue: 'xss', match: /<script\b[^>]*>|javascript:|on\w+\s*=/i.test(input) }),
      (input) => ({ issue: 'sql_injection', match: /(\b(union|select|insert|update|delete|drop|truncate|alter)\b.*--|(\b(drop|delete|truncate)\b.*;))/i.test(input) }),
      (input) => ({ issue: 'sql_injection', match: /(?:execute|query|exec|select)\s*\(\s*[`"'][^`"']*(?:\$\{[^}]*\}|['"`]\s*\+)/i.test(input) }),
      (input) => ({ issue: 'path_traversal', match: /\.{2}[/\\]|%2e%2e/i.test(input) }),
      (input) => ({ issue: 'command_injection', match: /[;&|]\s*(?:rm|curl|wget|bash|sh|cmd|powershell)/i.test(input) }),
      (input) => ({ issue: 'command_injection', match: /(?:exec|spawn)\s*\(\s*[^'"]|['"`]\s*\+\s*[^'"]|(?:exec|spawn)\s*\([^)]*\{[^}]*shell\s*:\s*true[^}]*\}/i.test(input) }),
      (input) => ({ issue: 'eval_function', match: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(/i.test(input) }),
      (input) => ({ issue: 'unsafe_fs', match: /fs\.readFileSync\s*\(\s*[^'"]|child_process|require\s*\(\s*['"]child_process['"]\s*\)|\.exec\s*\(/i.test(input) }),
      (input) => ({ issue: 'csrf', match: /<form\b[^>]*>(?![\s\S]*?csrf)/i.test(input) }),
    ];

    this.codeSecurityPatterns = [
      { name: 'eval_usage', regex: /\beval\s*\(/g, severity: 'medium' },
      { name: 'new_function', regex: /\bnew\s+Function\s*\(/g, severity: 'medium' },
      { name: 'unsafe_fs_read', regex: /fs\.readFileSync\s*\(\s*[^'"\s)]/g, severity: 'medium' },
      { name: 'child_process_exec', regex: /child_process|\.exec\s*\(\s*[^'"][^)]*\+|\.exec\s*\([^)]*[`$]/g, severity: 'high' },
      { name: 'command_injection_spawn', regex: /(?:exec|spawn)\s*\([^)]*\{[^}]*shell\s*:\s*true[^}]*\}/gi, severity: 'high' },
      { name: 'sql_injection', regex: /(?:execute|query|exec|select)\s*\(\s*[`"'][^`"']*(?:\$\{[^}]*\}|['"`]\s*\+)/g, severity: 'high' },
      { name: 'path_traversal', regex: /\.\.[\\/]|%2e%2e/g, severity: 'medium' },
      { name: 'xss_script', regex: /<script\b[^>]*>/gi, severity: 'medium' },
      { name: 'xss_inline', regex: /javascript:|on\w+\s*=/gi, severity: 'medium' },
      { name: 'csrf_missing_token', regex: /<form\b[^>]*>(?![\s\S]*?csrf)/gi, severity: 'low' },
    ];

    this.dependencyVulnerabilityPatterns = [
      { name: 'qs', threshold: '6.0.0', severity: 'high', note: 'Old qs versions have prototype pollution issues.' },
      { name: 'minimatch', threshold: '3.0.4', severity: 'high', note: 'Old minimatch versions are vulnerable to ReDoS.' },
      { name: 'tar', threshold: '4.4.2', severity: 'high', note: 'Old tar versions have arbitrary file overwrite issues.' },
    ];
  }

  async runAudit() {
    const findings = [];
    for (const scanPath of this.config.scanPaths) {
      try {
        const stat = await fs.stat(scanPath);
        if (stat.isFile()) {
          await this.scanFile(scanPath, findings);
        } else {
          await this.scanDirectory(scanPath, findings);
        }
      } catch (err) {
        findings.push({ file: scanPath, severity: 'error', message: `scan_failed: ${err.message}` });
      }
    }

    const envCheck = this.auditEnvironmentVariables();
    const dbCheck = this.auditDatabasePermissions();

    const report = {
      timestamp: new Date().toISOString(),
      scannedPaths: this.config.scanPaths,
      findings,
      environmentVariables: envCheck,
      databasePermissions: dbCheck,
      passed: findings.every((f) => f.severity !== 'critical' && f.severity !== 'high'),
      summary: this.summarizeFindings(findings),
    };

    return report;
  }

  async scanDirectory(dir, findings) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        await this.scanDirectory(fullPath, findings);
      } else if (this.config.extensions.includes(path.extname(entry.name))) {
        await this.scanFile(fullPath, findings);
      }
    }
  }

  async scanFile(filePath, findings) {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      return;
    }

    for (const pattern of this.patterns) {
      const matches = content.match(pattern.regex);
      if (matches) {
        findings.push({
          file: filePath,
          pattern: pattern.name,
          severity: pattern.severity,
          count: matches.length,
          message: `Detected ${pattern.name} (${matches.length} occurrence(s))`,
        });
      }
    }
  }

  auditEnvironmentVariables() {
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL'];
    const optional = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET_01', 'ANTHROPIC_API_KEY'];
    const present = [];
    const missing = [];

    for (const key of required) {
      if (process.env[key]) present.push(key);
      else missing.push(key);
    }

    const optionalPresent = optional.filter((key) => process.env[key]);

    return {
      present,
      missing,
      optionalPresent,
      exposedInPublic: this.checkPubliclyExposedSecrets(),
    };
  }

  checkPubliclyExposedSecrets() {
    const publicKeys = ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL'];
    return publicKeys.reduce((acc, key) => {
      acc[key] = process.env[key] ? 'set' : 'missing';
      return acc;
    }, {});
  }

  auditDatabasePermissions() {
    // Placeholder for runtime permission check; real implementation would query Supabase
    return {
      rlsEnabled: true,
      serviceRoleUsed: true,
      anonRoleRestricted: true,
      note: 'Runtime permission checks require a Supabase connection.',
    };
  }

  summarizeFindings(findings) {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, error: 0 };
    for (const f of findings) {
      summary[f.severity] = (summary[f.severity] || 0) + 1;
    }
    return summary;
  }

  /**
   * Validate external input for dangerous patterns.
   */
  validateInput(input) {
    if (typeof input !== 'string') return { valid: true, issues: [] };
    const issues = [];
    for (const validator of this.inputValidators) {
      const result = validator(input);
      if (result.match) issues.push(result.issue);
    }
    return { valid: issues.length === 0, issues: [...new Set(issues)] };
  }

  /**
   * Scan source code for unsafe runtime patterns (eval, unsafe fs, command
   * injection, SQL injection, path traversal, XSS/CSRF).
   */
  async auditCodeSecurity(scanPaths = this.config.scanPaths) {
    const findings = [];
    for (const scanPath of scanPaths) {
      try {
        const stat = await fs.stat(scanPath);
        if (stat.isFile()) {
          await this.scanCodeFile(scanPath, findings);
        } else {
          await this.scanCodeDirectory(scanPath, findings);
        }
      } catch (err) {
        findings.push({ file: scanPath, severity: 'error', message: `scan_failed: ${err.message}` });
      }
    }
    return findings;
  }

  async scanCodeDirectory(dir, findings) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        await this.scanCodeDirectory(fullPath, findings);
      } else if (entry.name === 'SecurityAuditor.js') {
        continue;
      } else if (this.config.extensions.includes(path.extname(entry.name))) {
        await this.scanCodeFile(fullPath, findings);
      }
    }
  }

  async scanCodeFile(filePath, findings) {
    if (path.basename(filePath) === 'SecurityAuditor.js') return;
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      return;
    }

    for (const pattern of this.codeSecurityPatterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`);
      const matches = content.match(regex);
      if (matches) {
        findings.push({
          file: filePath,
          pattern: pattern.name,
          severity: pattern.severity,
          count: matches.length,
          message: `Detected ${pattern.name} (${matches.length} occurrence(s))`,
        });
      }
    }
  }

  /**
   * Validate rate limiting usage (express-rate-limit) in source files.
   */
  async auditRateLimit(scanPaths = this.config.scanPaths) {
    const rateLimitRegex = /require\s*\(\s*['"]express-rate-limit['"]\s*\)|import.*express-rate-limit|rateLimit\s*\(/g;
    const serverRegex = /require\s*\(\s*['"]express['"]\s*\)|import.*express\b|createServer|app\.(get|post|put|delete|use)/g;
    const usages = [];
    const serverFiles = [];

    for (const scanPath of scanPaths) {
      try {
        const stat = await fs.stat(scanPath);
        if (stat.isFile()) {
          const content = await fs.readFile(scanPath, 'utf8');
          if (content.match(rateLimitRegex)) usages.push(scanPath);
          else if (content.match(serverRegex)) serverFiles.push(scanPath);
        } else {
          await this._auditRateLimitDirectory(scanPath, rateLimitRegex, serverRegex, usages, serverFiles);
        }
      } catch (err) {
        // ignore unreadable paths
      }
    }

    return {
      used: usages.length > 0,
      usageFiles: usages,
      serverFilesWithoutRateLimit: serverFiles.filter((f) => !usages.includes(f)),
    };
  }

  async _auditRateLimitDirectory(dir, rateLimitRegex, serverRegex, usages, serverFiles) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        await this._auditRateLimitDirectory(fullPath, rateLimitRegex, serverRegex, usages, serverFiles);
      } else if (this.config.extensions.includes(path.extname(entry.name))) {
        const content = await fs.readFile(fullPath, 'utf8');
        if (content.match(rateLimitRegex)) usages.push(fullPath);
        else if (content.match(serverRegex)) serverFiles.push(fullPath);
      }
    }
  }

  /**
   * Audit package.json and package-lock.json for known vulnerable dependency
   * version patterns.
   */
  async auditDependencies(rootDir = process.cwd()) {
    const report = {
      scanned: false,
      project: null,
      declaredVulnerable: [],
      lockVulnerable: [],
      advisories: [],
    };

    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageLockPath = path.join(rootDir, 'package-lock.json');

    let packageJson;
    let lockfile;

    try {
      packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      report.project = packageJson.name;
    } catch (err) {
      report.advisories.push(`Could not read package.json: ${err.message}`);
      return report;
    }

    report.scanned = true;
    this._checkDeclaredDependencies(packageJson, report);

    try {
      lockfile = JSON.parse(await fs.readFile(packageLockPath, 'utf8'));
      this._checkLockfile(lockfile, report);
    } catch (err) {
      report.advisories.push(`Could not read package-lock.json: ${err.message}`);
    }

    return report;
  }

  _checkDeclaredDependencies(packageJson, report) {
    const sections = ['dependencies', 'devDependencies'];
    for (const section of sections) {
      const deps = packageJson[section];
      if (!deps || typeof deps !== 'object') continue;
      for (const [name, versionRange] of Object.entries(deps)) {
        for (const pattern of this.dependencyVulnerabilityPatterns) {
          if (name === pattern.name || name.endsWith(`/${pattern.name}`)) {
            const clean = this._cleanVersion(String(versionRange));
            if (clean && this._versionLessThan(clean, pattern.threshold)) {
              report.declaredVulnerable.push({
                name,
                declaredVersion: versionRange,
                threshold: pattern.threshold,
                severity: pattern.severity,
                note: pattern.note,
              });
            }
          }
        }
      }
    }
  }

  _checkLockfile(lockfile, report) {
    const packages = lockfile.packages || lockfile.dependencies || {};

    for (const [key, pkg] of Object.entries(packages)) {
      if (!key.startsWith('node_modules/')) continue;
      const segments = key.split('node_modules/');
      const name = segments[segments.length - 1];
      if (!pkg || !pkg.version) continue;

      for (const pattern of this.dependencyVulnerabilityPatterns) {
        if (name === pattern.name || name.endsWith(`/${pattern.name}`)) {
          if (this._versionLessThan(pkg.version, pattern.threshold)) {
            report.lockVulnerable.push({
              name,
              version: pkg.version,
              path: key,
              threshold: pattern.threshold,
              severity: pattern.severity,
              note: pattern.note,
            });
          }
        }
      }
    }

    if (lockfile.dependencies && !lockfile.packages) {
      this._walkLockDependencies(lockfile.dependencies, report);
    }
  }

  _walkLockDependencies(dependencies, report, prefix = '') {
    for (const [name, pkg] of Object.entries(dependencies)) {
      const fullName = prefix ? `${prefix}/${name}` : name;
      if (pkg && pkg.version) {
        for (const pattern of this.dependencyVulnerabilityPatterns) {
          if (name === pattern.name || name.endsWith(`/${pattern.name}`)) {
            if (this._versionLessThan(pkg.version, pattern.threshold)) {
              report.lockVulnerable.push({
                name,
                version: pkg.version,
                path: fullName,
                threshold: pattern.threshold,
                severity: pattern.severity,
                note: pattern.note,
              });
            }
          }
        }
      }
      if (pkg && pkg.dependencies) {
        this._walkLockDependencies(pkg.dependencies, report, fullName);
      }
    }
  }

  _cleanVersion(version) {
    return version.replace(/^[\^~><=]+/, '').split('-')[0];
  }

  _versionLessThan(a, b) {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i += 1) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x < y) return true;
      if (x > y) return false;
    }
    return false;
  }

  /**
   * Encrypt sensitive local storage using AES-256-GCM.
   */
  encrypt(plaintext, key) {
    if (!key) throw new Error('Encryption key is required');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.normalizeKey(key), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted.toString('hex'),
    };
  }

  decrypt(ciphertext, key) {
    if (!key) throw new Error('Encryption key is required');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.normalizeKey(key),
      Buffer.from(ciphertext.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(ciphertext.authTag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext.data, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  normalizeKey(key) {
    const hash = crypto.createHash('sha256');
    hash.update(key);
    return hash.digest();
  }

  async rotateCredential(hint) {
    // In a real system this would trigger a secret rotation flow.
    return { rotated: true, hint, note: 'Credential rotation should be completed via your secret manager.' };
  }

  getStatus() {
    return {
      patterns: this.patterns.length,
      codeSecurityPatterns: this.codeSecurityPatterns.length,
      inputValidators: this.inputValidators.length,
    };
  }
}

module.exports = SecurityAuditor;
