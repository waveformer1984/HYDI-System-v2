/**
 * Secret Scanner
 *
 * Scans repository files, configuration, and runtime environment for
 * likely secret material. Produces metadata and redacted evidence only.
 *
 * NEVER prints discovered secret values. Only reports:
 *   - File path
 *   - Line number
 *   - Pattern type (api_key, private_key, jwt, etc.)
 *   - Redacted preview (first 4 + last 4 chars, middle replaced with *)
 *
 * Detection patterns:
 *   - API keys (Stripe sk_, SendGrid SG., Google AIza, Twilio SK)
 *   - Access tokens (Bearer tokens, OAuth tokens)
 *   - JWTs (eyJ... header)
 *   - Private keys (-----BEGIN ... PRIVATE KEY-----)
 *   - Certificates (-----BEGIN CERTIFICATE-----)
 *   - Cloud credentials (AWS AKIA, GCP service account JSON)
 *   - Database connection strings (postgres://, mongodb://)
 *   - High-entropy strings (Shannon entropy > 4.5)
 *   - Generic env var assignments with secret-like names
 *
 * Allowlists:
 *   - Test fixtures with known non-secret values
 *   - .env.example files (template values)
 *   - Documentation examples
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/**
 * A secret scan finding.
 *
 * SECURITY: The `redactedPreview` field shows only the first 4 and last 4
 * characters of the matched value, with the middle replaced by asterisks.
 * The actual value is NEVER included.
 */
export interface SecretScanFinding {
  /** Unique finding ID */
  findingId: string;
  /** File path (relative to repo root) */
  filePath: string;
  /** Line number (1-based) */
  lineNumber: number;
  /** The pattern type that matched */
  patternType: SecretPatternType;
  /** Redacted preview (first 4 + last 4 chars) */
  redactedPreview: string;
  /** SHA-256 fingerprint of the matched value (first 16 hex chars) */
  fingerprint: string;
  /** The env var name if this looks like an assignment */
  envVarName: string | null;
  /** Whether this is in the allowlist */
  allowlisted: boolean;
  /** Confidence that this is a real secret (0-1) */
  confidence: number;
  /** Description of what was detected */
  description: string;
}

/**
 * Types of secret patterns the scanner can detect.
 */
export type SecretPatternType =
  | 'stripe_secret_key'
  | 'stripe_webhook_secret'
  | 'sendgrid_api_key'
  | 'google_api_key'
  | 'twilio_auth_token'
  | 'aws_access_key'
  | 'aws_secret_key'
  | 'private_key'
  | 'certificate'
  | 'jwt'
  | 'bearer_token'
  | 'connection_string'
  | 'high_entropy_string'
  | 'generic_secret_assignment'
  | 'service_account_json';

/**
 * Result of a secret scan.
 */
export interface SecretScanResult {
  findings: SecretScanFinding[];
  scannedFiles: number;
  scannedLines: number;
  scanDurationMs: number;
  allowlistedCount: number;
  newFindingsCount: number;
  timestamp: string;
}

/**
 * Patterns for detecting secrets.
 * Each pattern has a regex and a confidence level.
 */
interface SecretPattern {
  type: SecretPatternType;
  regex: RegExp;
  confidence: number;
  description: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'stripe_secret_key',
    regex: /sk_(?:live|test)_[a-zA-Z0-9]{20,}/,
    confidence: 0.99,
    description: 'Stripe secret API key',
  },
  {
    type: 'stripe_webhook_secret',
    regex: /whsec_[a-zA-Z0-9]{20,}/,
    confidence: 0.99,
    description: 'Stripe webhook signing secret',
  },
  {
    type: 'sendgrid_api_key',
    regex: /SG\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/,
    confidence: 0.95,
    description: 'SendGrid API key',
  },
  {
    type: 'google_api_key',
    regex: /AIza[a-zA-Z0-9_-]{35}/,
    confidence: 0.95,
    description: 'Google API key',
  },
  {
    type: 'twilio_auth_token',
    regex: /TWILIO_AUTH_TOKEN\s*=\s*([a-f0-9]{32})/,
    confidence: 0.9,
    description: 'Twilio auth token',
  },
  {
    type: 'aws_access_key',
    regex: /AKIA[0-9A-Z]{16}/,
    confidence: 0.99,
    description: 'AWS access key ID',
  },
  {
    type: 'private_key',
    regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE KEY-----/,
    confidence: 0.99,
    description: 'Private key material',
  },
  {
    type: 'certificate',
    regex: /-----BEGIN\s+CERTIFICATE-----/,
    confidence: 0.95,
    description: 'Certificate material',
  },
  {
    type: 'jwt',
    regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/,
    confidence: 0.9,
    description: 'JWT token',
  },
  {
    type: 'bearer_token',
    regex: /Bearer\s+[a-zA-Z0-9_-]{20,}/,
    confidence: 0.7,
    description: 'Bearer token',
  },
  {
    type: 'connection_string',
    regex: /(?:postgres|mongodb|redis|amqp):\/\/[^\s]+:[^\s]+@/,
    confidence: 0.9,
    description: 'Database connection string with credentials',
  },
  {
    type: 'service_account_json',
    regex: /"type"\s*:\s*"service_account"/,
    confidence: 0.95,
    description: 'Google service account JSON',
  },
];

/**
 * Generic secret assignment pattern: VAR_NAME=value where VAR_NAME looks secret.
 */
const SECRET_VAR_NAMES = /^(?:[A-Z_]*SECRET[A-Z_]*|[A-Z_]*PASSWORD[A-Z_]*|[A-Z_]*TOKEN[A-Z_]*|[A-Z_]*API_KEY[A-Z_]*|[A-Z_]*PRIVATE_KEY[A-Z_]*|[A-Z_]*AUTH[A-Z_]*)\s*=\s*(.+)$/;

/**
 * Allowlisted paths — these files are known to contain non-secret test values.
 */
const ALLOWLIST_PATHS = [
  /\.env\.example$/,
  /\.env\.sample$/,
  /\/tests\//,
  /\/__tests__\//,
  /\/test\//,
  /\/spec\//,
  /\.test\./,
  /\.spec\./,
  /\/fixtures\//,
  /\/mocks\//,
];

/**
 * Allowlisted values — these values are known non-secrets.
 * NOTE: Do NOT include bare /test/i — it matches real Stripe test keys (sk_test_...).
 * Use specific placeholder patterns instead.
 */
const ALLOWLIST_VALUES = [
  /your.*here/i,
  /example/i,
  /placeholder/i,
  /dummy/i,
  /fake/i,
  /^test$/i,           // Only match the standalone word "test", not "sk_test_..."
  /sample/i,
  /xxx+/i,
  /DRY_RUN/,
  /NOT_A_REAL_KEY/,
  /sk_test_DRY_RUN/,
  /SG\.DRY_RUN/,
  /SK_DRY_RUN/,
  /MOCK_DRY_RUN/,
  /mock_key_/,
  /mock_rotated_/,
];

/**
 * Directories to skip during scanning.
 */
const SKIP_DIRS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.hydi-operational',
  'coverage',
  '.cache',
];

/**
 * File extensions to scan.
 */
const SCAN_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.json', '.yml', '.yaml', '.env',
  '.env.local', '.env.production', '.env.staging', '.env.development',
  '.config', '.conf', '.ini', '.properties', '.sh', '.bash', '.ps1',
  '.sql', '.md', '.txt', '.xml', '.toml',
]);

/**
 * The secret scanner.
 */
export class SecretScanner {
  private root: string;
  private allowlistPaths: RegExp[];
  private allowlistValues: RegExp[];

  constructor(root: string) {
    this.root = root;
    this.allowlistPaths = ALLOWLIST_PATHS;
    this.allowlistValues = ALLOWLIST_VALUES;
  }

  /**
   * Scan the repository for secrets.
   *
   * SECURITY: This method NEVER returns secret values. Only redacted previews
   * and fingerprints are included in findings.
   */
  async scan(options?: { maxFiles?: number; includeSkipped?: boolean }): Promise<SecretScanResult> {
    const start = Date.now();
    const findings: SecretScanFinding[] = [];
    let scannedFiles = 0;
    const scannedLines = 0;
    const maxFiles = options?.maxFiles ?? 10000;

    await this.scanDirectory(this.root, findings, { scannedFiles: 0, scannedLines: 0, maxFiles }, (count) => {
      scannedFiles = count;
    });

    // Count allowlisted and new findings
    const allowlistedCount = findings.filter(f => f.allowlisted).length;
    const newFindingsCount = findings.filter(f => !f.allowlisted).length;

    return {
      findings,
      scannedFiles,
      scannedLines,
      scanDurationMs: Date.now() - start,
      allowlistedCount,
      newFindingsCount,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Scan a specific file for secrets.
   */
  async scanFile(filePath: string): Promise<SecretScanFinding[]> {
    const findings: SecretScanFinding[] = [];
    const fullPath = path.resolve(this.root, filePath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return findings;
    }

    const isAllowlisted = this.isAllowlistedPath(filePath);

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        this.scanLine(line, filePath, i + 1, isAllowlisted, findings);
      }
    } catch {
      // Skip unreadable files
    }

    return findings;
  }

  private scanDirectory(
    dir: string,
    findings: SecretScanFinding[],
    counters: { scannedFiles: number; scannedLines: number; maxFiles: number },
    onScannedFiles?: (count: number) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (counters.scannedFiles >= counters.maxFiles) {
        resolve();
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        resolve();
        return;
      }

      const promises: Promise<void>[] = [];

      for (const entry of entries) {
        if (counters.scannedFiles >= counters.maxFiles) break;

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.root, fullPath);

        if (entry.isDirectory()) {
          if (SKIP_DIRS.includes(entry.name)) continue;
          promises.push(this.scanDirectory(fullPath, findings, counters, onScannedFiles));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          const shouldScan = SCAN_EXTENSIONS.has(ext) || entry.name.startsWith('.env');

          if (shouldScan) {
            counters.scannedFiles++;
            onScannedFiles?.(counters.scannedFiles);

            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              counters.scannedLines += lines.length;

              const isAllowlisted = this.isAllowlistedPath(relativePath);

              for (let i = 0; i < lines.length; i++) {
                this.scanLine(lines[i], relativePath, i + 1, isAllowlisted, findings);
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      }

      Promise.all(promises).then(() => resolve());
    });
  }

  private scanLine(
    line: string,
    filePath: string,
    lineNumber: number,
    isAllowlisted: boolean,
    findings: SecretScanFinding[],
  ): void {
    // Check each pattern
    for (const pattern of SECRET_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match) {
        const value = match[0];
        if (this.isAllowlistedValue(value)) continue;

        findings.push(this.createFinding(filePath, lineNumber, pattern.type, value, pattern.confidence, pattern.description, isAllowlisted));
      }
    }

    // Check generic secret assignment
    const assignmentMatch = line.match(SECRET_VAR_NAMES);
    if (assignmentMatch) {
      const value = assignmentMatch[1].replace(/['"]/g, '').trim();
      if (value.length > 8 && !this.isAllowlistedValue(value)) {
        findings.push(this.createFinding(filePath, lineNumber, 'generic_secret_assignment', value, 0.6, 'Generic secret assignment', isAllowlisted, assignmentMatch[0].split('=')[0].trim()));
      }
    }

    // Check for high-entropy strings (only in assignments to avoid false positives)
    const entropyMatch = line.match(/=\s*["']?([A-Za-z0-9+/=]{32,})["']?/);
    if (entropyMatch) {
      const value = entropyMatch[1];
      const entropy = this.calculateEntropy(value);
      if (entropy > 4.5 && !this.isAllowlistedValue(value)) {
        // Only add if not already found by a more specific pattern
        const alreadyFound = findings.some(f => f.lineNumber === lineNumber && f.filePath === filePath);
        if (!alreadyFound) {
          findings.push(this.createFinding(filePath, lineNumber, 'high_entropy_string', value, 0.5, `High-entropy string (entropy=${entropy.toFixed(2)})`, isAllowlisted));
        }
      }
    }
  }

  private createFinding(
    filePath: string,
    lineNumber: number,
    patternType: SecretPatternType,
    value: string,
    confidence: number,
    description: string,
    isAllowlisted: boolean,
    envVarName?: string,
  ): SecretScanFinding {
    return {
      findingId: `${filePath}:${lineNumber}:${patternType}`,
      filePath,
      lineNumber,
      patternType,
      redactedPreview: this.redact(value),
      fingerprint: createHash('sha256').update(value).digest('hex').slice(0, 16),
      envVarName: envVarName ?? null,
      allowlisted: isAllowlisted || this.isAllowlistedValue(value),
      confidence,
      description,
    };
  }

  /**
   * Redact a secret value — show only first 4 and last 4 characters.
   * SECURITY: This ensures the full value is never exposed in findings.
   */
  private redact(value: string): string {
    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }
    return value.slice(0, 4) + '*'.repeat(Math.min(value.length - 8, 20)) + value.slice(-4);
  }

  /**
   * Calculate Shannon entropy of a string.
   */
  private calculateEntropy(value: string): number {
    const freq: Record<string, number> = {};
    for (const char of value) {
      freq[char] = (freq[char] ?? 0) + 1;
    }
    const len = value.length;
    let entropy = 0;
    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private isAllowlistedPath(filePath: string): boolean {
    return this.allowlistPaths.some(re => re.test(filePath));
  }

  private isAllowlistedValue(value: string): boolean {
    return this.allowlistValues.some(re => re.test(value));
  }

  /**
   * Add a custom allowlist path pattern.
   */
  addAllowlistPath(pattern: RegExp): void {
    this.allowlistPaths.push(pattern);
  }

  /**
   * Add a custom allowlist value pattern.
   */
  addAllowlistValue(pattern: RegExp): void {
    this.allowlistValues.push(pattern);
  }
}
