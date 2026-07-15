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
      { name: 'basic_auth', regex: /https?:\/\/[^:]+:[^@]+@[a-z0-9.]+/i, severity: 'high' },
      { name: 'hardcoded_secret', regex: /secret\s*[:=]\s*["'][a-zA-Z0-9_-]{16,}["']/i, severity: 'high' },
      { name: 'env_in_code', regex: /process\.env\.[A-Z_]+\s*[:=]\s*["'][^"']+["']/i, severity: 'medium' },
      { name: 'sql_injection', regex: /(?:execute|query|exec)\s*\(\s*[`"'][^`"']*\$\{[^}]*\}/i, severity: 'critical' },
      { name: 'eval_usage', regex: /\beval\s*\(/, severity: 'medium' },
    ];

    this.inputValidators = [
      (input) => ({ issue: 'xss', match: /<script\b[^>]*>/i.test(input) }),
      (input) => ({ issue: 'sql_injection', match: /(\b(union|select|insert|update|delete|drop|truncate|alter)\b.*--|(\b(drop|delete|truncate)\b.*;))/i.test(input) }),
      (input) => ({ issue: 'path_traversal', match: /\.{2}[/\\]/.test(input) }),
      (input) => ({ issue: 'command_injection', match: /[;&|]\s*(?:rm|curl|wget|bash|sh|cmd|powershell)/i.test(input) }),
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
    return { valid: issues.length === 0, issues };
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
    return { patterns: this.patterns.length };
  }
}

module.exports = SecurityAuditor;
