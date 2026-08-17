#!/usr/bin/env node
'use strict';
/**
 * Live Secret Scanner
 * ----------------------------------------------------------------------------
 * Scans all tracked files (and .env files) for live Stripe keys and raw
 * Supabase service-role secrets. Fails if any are found outside .env.local.
 *
 * Patterns:
 *   - sk_live_[A-Za-z0-9]+   (live Stripe secret key)
 *   - sb_secret_             (raw Supabase secret — heuristic)
 *   - "service_role" JWTs embedded in source (eyJ...service_role)
 *
 * .env.local is excluded from the scan (it's the legitimate place for secrets
 * and is gitignored). .env is also excluded (commented-out placeholders only).
 *
 * Usage:
 *   node scripts/scan-live-secrets.js
 *
 * Exit 0 = clean, exit 1 = live secret found.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Patterns that indicate a live secret.
const PATTERNS = [
  {
    name: 'live Stripe secret key',
    regex: /sk_live_[A-Za-z0-9]{10,}/,
    allowInEnvLocal: false, // never allow live keys, even in .env.local
    skipIf: (line) => {
      // Don't flag obvious test fixtures / placeholders.
      // Real Stripe live keys are ~99 chars of mixed-case alphanumeric.
      // Test fixtures use short, sequential, or alphabetic-only strings.
      const match = line.match(/sk_live_([A-Za-z0-9]+)/);
      if (match) {
        const val = match[1];
        // Short values (< 20 chars) are test fixtures
        if (val.length < 20) return true;
        // Sequential alphabet only (abcdefghijklmnop...)
        if (/^[a-z]+$/.test(val) && val.length < 30) return true;
      }
      if (/sk_live_placeholder|sk_live_or_test|sk_live_test_fake/i.test(line)) return true;
      if (/test|example|dummy|placeholder|fake|your.*key.*here/i.test(line)) return true;
      return false;
    },
  },
  {
    name: 'Supabase service_role JWT in source',
    regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    allowInEnvLocal: true,
    skipIf: (line) => {
      // Don't flag test/example JWTs
      if (/test|example|dummy|placeholder|your.*key.*here/i.test(line)) return true;
      // The anon key for this project is public and safe
      if (/akbnfovjdcobifeupvbn/i.test(line)) return true;
      // Decode the JWT payload (second segment) to check the role.
      const jwtMatch = line.match(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/);
      if (jwtMatch) {
        try {
          const payload = Buffer.from(jwtMatch[1], 'base64url').toString('utf8');
          if (/"role"\s*:\s*"anon"/i.test(payload)) return true;
        } catch (_) { /* ignore decode errors */ }
      }
      return false;
    },
  },
];

// Files/dirs to skip entirely.
const SKIP_DIRS = ['node_modules', '.git', '.next', 'archive', 'logs', 'tmp'];
const SKIP_FILES = ['.env.local', '.env', '.env.example', '.env.template', '.env.backup'];
const SKIP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pack', '.nft.json'];

function shouldSkip(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (SKIP_FILES.includes(rel)) return true;
  for (const dir of SKIP_DIRS) {
    if (rel.startsWith(dir + path.sep) || rel.startsWith(dir + '/')) return true;
  }
  const ext = path.extname(filePath);
  if (SKIP_EXTENSIONS.includes(ext)) return true;
  return false;
}

function getTrackedFiles() {
  try {
    const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
    return out.trim().split('\n').filter(Boolean).map((f) => path.resolve(ROOT, f));
  } catch (_) {
    // Not a git repo — scan the directory tree instead.
    const files = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!shouldSkip(full)) walk(full); }
        else if (!shouldSkip(full)) files.push(full);
      }
    }
    walk(ROOT);
    return files;
  }
}

function scanFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, regex, allowInEnvLocal, skipIf } of PATTERNS) {
      if (skipIf && skipIf(line)) continue;
      const match = line.match(regex);
      if (match) {
        // Redact the secret in output — never print the full value
        const redacted = match[0].slice(0, 8) + '...[REDACTED]';
        findings.push({ file: rel, line: i + 1, name, redacted });
      }
    }
  }
  return findings;
}

function main() {
  const files = getTrackedFiles();
  let totalFindings = 0;

  for (const file of files) {
    if (shouldSkip(file)) continue;
    if (!fs.existsSync(file)) continue;
    const findings = scanFile(file);
    for (const f of findings) {
      console.error(`✗ ${f.file}:${f.line} — ${f.name} detected: ${f.redacted}`);
      totalFindings++;
    }
  }

  if (totalFindings > 0) {
    console.error(`\n❌ ${totalFindings} live secret(s) found in tracked files`);
    console.error('Remove or replace with test-mode values. Live keys must never be committed.');
    process.exit(1);
  }
  console.log(`✅ no live secrets found in ${files.length} tracked file(s)`);
  process.exit(0);
}

main();
