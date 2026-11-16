/**
 * Proof-of-value acceptance gate — exercises real modules where the cloud VM can.
 * Frank production, Ollama, and Stripe live paths are explicitly skipped with reason.
 */

const http = require('http');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function gitSha() {
  return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fetchHealth(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, { timeout: 4000 }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

describe('Proof of value acceptance', () => {
  const sha = gitSha();

  it('records commit SHA for evidence chain', () => {
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('startup: Next heidi-web responds on :3000 (degraded allowed without Supabase)', async () => {
    const { status, body } = await fetchHealth('http://127.0.0.1:3000/api/health');
    expect(status).toBe(200);
    expect(body).toHaveProperty('status');
    expect(['ok', 'degraded', 'unhealthy']).toContain(body.status);
  });

  it('execution: mission worker completes read-only lifecycle (unit truth)', () => {
    execSync(
      'npx jest tests/unit/mission-worker.test.js --runInBand --forceExit --testNamePattern="read-only"',
      { cwd: ROOT, encoding: 'utf8', timeout: 120000, stdio: 'pipe' }
    );
    expect(true).toBe(true);
  });

  it('evolution: assess + dashboard CLI emit structured JSON', () => {
    const assess = execSync('node scripts/heidi-self-improve.js assess', { cwd: ROOT, encoding: 'utf8' });
    const dash = execSync('node scripts/heidi-self-improve.js dashboard', { cwd: ROOT, encoding: 'utf8' });
    expect(JSON.parse(assess)).toHaveProperty('gaps');
    expect(JSON.parse(dash)).toHaveProperty('schema_version');
  });

  it('revenue: billing memory-tier acceptance passes without Stripe network', () => {
    execSync('npx jest tests/unit/billing/acceptance.memory.test.js --runInBand --forceExit', {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 180000,
    });
    expect(true).toBe(true);
  });

  it('mobile: BFF contract tests pass (mock upstream)', () => {
    execSync('npx jest tests/unit/heidi-mobile-api.test.js --runInBand --forceExit', {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 120000,
    });
    expect(true).toBe(true);
  });

  it('inference: Ollama on :11434 (skip when absent)', async () => {
    await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: 11434, path: '/api/tags', method: 'GET', timeout: 1500 }, (res) => {
        resolve(res.statusCode);
        res.resume();
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    }).then((code) => {
      if (code === null) {
        // Cloud VM — not Frank; do not fail the suite
        expect(code).toBeNull();
        return;
      }
      expect(code).toBe(200);
    });
  });

  it('Frank: tailnet heidi-pc unreachable from cloud (documented skip)', async () => {
    const dns = require('dns').promises;
    let resolved = true;
    try {
      await dns.lookup('heidi-pc.tailc50af2.ts.net');
    } catch {
      resolved = false;
    }
    if (!resolved) {
      expect(resolved).toBe(false);
      return;
    }
    // If DNS works, still only assert we do not claim LIVE Frank truth here
    const { loadLatestFrankProductionTruth } = require('../../lib/observation/frank-truth-loader');
    const truth = loadLatestFrankProductionTruth({ repoRoot: ROOT });
    expect(['LIVE', 'CACHED', 'UNAVAILABLE']).toContain(truth.availability);
  });
});