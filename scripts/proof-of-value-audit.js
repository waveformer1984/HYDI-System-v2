#!/usr/bin/env node
'use strict';

/**
 * Proof-of-value baseline collector — records ground truth without fabricating ops results.
 * Writes machine-readable evidence under artifacts/proof-of-value/evidence/.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'artifacts', 'proof-of-value', 'evidence');

function sha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function probeUrl(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
        if (body.length > 4096) res.destroy();
      });
      res.on('end', () => {
        resolve({ ok: true, status: res.statusCode, body_snippet: body.slice(0, 800) });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: '/', method: 'GET', timeout: 1500 }, (res) => {
      resolve({ open: true, status: res.statusCode });
      res.resume();
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ open: false, error: 'timeout' });
    });
    req.on('error', (e) => resolve({ open: false, error: e.message }));
    req.end();
  });
}

async function main() {
  const generated_at = new Date().toISOString();
  const commit = sha();
  const probes = {
    health_3000: await probeUrl('http://127.0.0.1:3000/api/health'),
    port_3005: await portOpen('127.0.0.1', 3005),
    port_54321: await portOpen('127.0.0.1', 54321),
    ollama_11434: await portOpen('127.0.0.1', 11434),
  };

  let jest;
  try {
    const out = execSync(
      'npx jest tests/proof-of-value/acceptance.test.js --testMatch="**/*.test.js" --runInBand --forceExit --json',
      { cwd: ROOT, encoding: 'utf8', timeout: 600000, env: { ...process.env, POV_AUDIT: '1' } }
    );
    jest = JSON.parse(out);
  } catch (e) {
    jest = {
      skipped: false,
      error: e instanceof Error ? e.message : String(e),
      stdout: e.stdout ? String(e.stdout).slice(-2000) : undefined,
    };
  }

  const record = {
    schema: 'heidi-proof-of-value-v1',
    generated_at,
    commit,
    environment: {
      node: process.version,
      cwd: ROOT,
      host: require('os').hostname(),
    },
    probes,
    jest_acceptance: jest,
  };

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `audit-${generated_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ ok: true, evidence: path.relative(ROOT, file), commit }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});