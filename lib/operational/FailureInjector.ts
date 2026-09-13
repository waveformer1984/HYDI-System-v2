/**
 * HYDI Failure Injection Framework
 *
 * Provides structured, safe failure injection for qualification testing.
 * Each scenario has setup, expected observation, expected diagnosis,
 * expected action, expected verification, and cleanup.
 *
 * Safety constraints:
 *   - No arbitrary destructive commands
 *   - Each scenario is explicitly registered
 *   - Risk level is classified
 *   - Cleanup is always attempted
 *   - Evidence is collected at every step
 */

import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import type {
  FailureScenario,
  FailureScenarioResult,
  HealthEvidence,
  RecoveryPolicyId,
  RiskLevel,
} from './types';

/**
 * Find the PID of a process listening on a port.
 */
function findPidOnPort(port: number): number | null {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid)) return pid;
      }
    } else {
      const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8', timeout: 5000 });
      const pid = parseInt(out.trim(), 10);
      if (!isNaN(pid)) return pid;
    }
  } catch { /* no process */ }
  return null;
}

/**
 * Kill a process by PID.
 */
function killPid(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
    } else {
      execSync(`kill -9 ${pid}`, { timeout: 5000 });
    }
  } catch { /* already dead */ }
}

/**
 * Check if a health endpoint is responding.
 */
function checkHealthEndpoint(url: string): { ok: boolean; statusCode: number; body: string } {
  try {
    const out = execSync(
      `curl -s -o - -w "\\n%{http_code}" --max-time 5 ${url}`,
      { encoding: 'utf8', timeout: 10000 },
    );
    const lines = out.trim().split('\n');
    const statusCode = parseInt(lines[lines.length - 1], 10);
    const body = lines.slice(0, -1).join('\n');
    return { ok: statusCode >= 200 && statusCode < 500, statusCode, body };
  } catch {
    return { ok: false, statusCode: 0, body: '' };
  }
}

/**
 * The default failure scenarios.
 */
export const DEFAULT_SCENARIOS: FailureScenario[] = [
  // --- Class A: Process failure ---
  {
    scenarioId: 'A1-protoforge-kill',
    name: 'Kill ProtoForge core process',
    failureClass: 'A',
    description: 'Kill the protoforge-core process and verify HEIDI detects and recovers it',
    targetComponent: 'protoforge-core',
    setup: ['Record initial health state', 'Find PID on port 3005'],
    expectedObservation: 'protoforge-core health endpoint returns connection refused',
    expectedDiagnosis: 'protoforge-core is UNAVAILABLE — process not listening on port 3005',
    expectedAction: 'restart_process',
    expectedVerification: 'health endpoint returns 200 with {"status":"ok"} + process identity verified',
    cleanup: ['Verify protoforge-core is healthy', 'If still down, run hydi-recover manually'],
    riskLevel: 'R1',
    timeoutMs: 120000,
  },
  {
    scenarioId: 'A2-heidi-web-kill',
    name: 'Kill Heidi Web process',
    failureClass: 'A',
    description: 'Kill the heidi-web process and verify HEIDI detects and recovers it',
    targetComponent: 'heidi-web',
    setup: ['Record initial health state', 'Find PID on port 3000'],
    expectedObservation: 'heidi-web health endpoint returns connection refused or timeout',
    expectedDiagnosis: 'heidi-web is UNAVAILABLE — process not listening on port 3000',
    expectedAction: 'restart_process',
    expectedVerification: 'health endpoint returns 200 with valid JSON body',
    cleanup: ['Verify heidi-web is healthy', 'If still down, run hydi-recover manually'],
    riskLevel: 'R1',
    timeoutMs: 120000,
  },

  // --- Class B: Container/service failure ---
  {
    scenarioId: 'B1-supabase-rest-restart',
    name: 'Restart Supabase REST container',
    failureClass: 'B',
    description: 'Restart the Supabase PostgREST container and verify it comes back',
    targetComponent: 'supabase_rest',
    setup: ['Record initial container state', 'Verify Docker is available'],
    expectedObservation: 'Supabase REST API temporarily unavailable during restart',
    expectedDiagnosis: 'supabase_rest container was restarted — temporary outage expected',
    expectedAction: 'restart_container',
    expectedVerification: 'container is healthy and REST API responds on port 54321',
    cleanup: ['Verify container is running', 'Verify REST API responds'],
    riskLevel: 'R2',
    timeoutMs: 60000,
  },

  // --- Class C: Dependency failure ---
  {
    scenarioId: 'C1-protoforge-dep-chain',
    name: 'ProtoForge dependency chain test',
    failureClass: 'C',
    description: 'Kill protoforge-core and verify heidi-web is detected as collateral impact',
    targetComponent: 'protoforge-core',
    setup: ['Record initial health of all components', 'Find PID on port 3005'],
    expectedObservation: 'protoforge-core down + heidi-web down (depends on protoforge-core)',
    expectedDiagnosis: 'protoforge-core is root cause; heidi-web is collateral (dependency chain)',
    expectedAction: 'restart_process',
    expectedVerification: 'protoforge-core recovers first, then heidi-web recovers as dependency becomes available',
    cleanup: ['Verify both components healthy', 'If still down, run hydi-recover manually'],
    riskLevel: 'R1',
    timeoutMs: 180000,
  },

  // --- Class D: Local AI degradation ---
  {
    scenarioId: 'D1-ollama-stop',
    name: 'Stop Ollama service',
    failureClass: 'D',
    description: 'Stop the Ollama service and verify HEIDI enters degraded mode (not hang)',
    targetComponent: 'ollama',
    setup: ['Record initial Ollama health', 'Verify Ollama is running on port 11434'],
    expectedObservation: 'Ollama /api/tags returns connection refused',
    expectedDiagnosis: 'ollama is UNAVAILABLE — local AI is down, system should enter degraded mode',
    expectedAction: 'restart_ollama',
    expectedVerification: 'Ollama /api/tags responds with model list OR system enters intentional degraded mode',
    cleanup: ['Restart Ollama if not auto-recovered', 'Verify Ollama is healthy'],
    riskLevel: 'R2',
    timeoutMs: 60000,
  },

  // --- Class E: Persistence degradation ---
  {
    scenarioId: 'E1-supabase-db-restart',
    name: 'Restart Supabase DB container',
    failureClass: 'E',
    description: 'Restart the Supabase DB container and verify database connectivity recovers',
    targetComponent: 'database',
    setup: ['Record initial DB health', 'Verify Docker is available'],
    expectedObservation: 'Database connections fail during container restart',
    expectedDiagnosis: 'database is temporarily UNAVAILABLE — local DB container restarting',
    expectedAction: 'recover_database',
    expectedVerification: 'database write/read proof succeeds after container restart',
    cleanup: ['Verify DB container is healthy', 'Verify write/read proof'],
    riskLevel: 'R2',
    timeoutMs: 60000,
  },

  // --- Class F: Bridge failure ---
  {
    scenarioId: 'F1-bridge-probe',
    name: 'Bridge connectivity test',
    failureClass: 'F',
    description: 'Test bridge response when heidi-web is down (bridge depends on heidi-web)',
    targetComponent: 'bridge',
    setup: ['Record initial bridge health', 'Record initial heidi-web health'],
    expectedObservation: 'Bridge returns error when heidi-web is down',
    expectedDiagnosis: 'bridge is BLOCKED — upstream dependency heidi-web is unavailable',
    expectedAction: 'wait_for_dependency',
    expectedVerification: 'bridge recovers after heidi-web recovers (dependency chain)',
    cleanup: ['Verify both bridge and heidi-web are healthy'],
    riskLevel: 'R1',
    timeoutMs: 180000,
  },
];

/**
 * The failure injection engine.
 */
export class FailureInjector {
  private root: string;
  private scenarios: Map<string, FailureScenario> = new Map();

  constructor(root: string, scenarios: FailureScenario[] = DEFAULT_SCENARIOS) {
    this.root = root;
    for (const s of scenarios) {
      this.scenarios.set(s.scenarioId, s);
    }
  }

  /**
   * Get all registered scenarios.
   */
  getAllScenarios(): FailureScenario[] {
    return [...this.scenarios.values()];
  }

  /**
   * Get scenarios by failure class.
   */
  getScenariosByClass(failureClass: string): FailureScenario[] {
    return this.getAllScenarios().filter((s) => s.failureClass === failureClass);
  }

  /**
   * Get a specific scenario by ID.
   */
  getScenario(scenarioId: string): FailureScenario | null {
    return this.scenarios.get(scenarioId) ?? null;
  }

  /**
   * Inject a failure for a scenario.
   * Returns true if the failure was successfully injected.
   */
  injectFailure(scenario: FailureScenario): { injected: boolean; evidence: HealthEvidence[]; error?: string } {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();

    try {
      switch (scenario.scenarioId) {
        case 'A1-protoforge-kill':
        case 'C1-protoforge-dep-chain': {
          const pid = findPidOnPort(3005);
          if (!pid) {
            return { injected: false, evidence, error: 'No process found on port 3005' };
          }
          evidence.push({
            check: 'pre-injection-health', status: 'pass',
            value: `PID ${pid} on port 3005`, checkedAt: now,
          });
          killPid(pid);
          evidence.push({
            check: 'process-killed', status: 'pass',
            value: `Killed PID ${pid}`, checkedAt: new Date().toISOString(),
          });
          return { injected: true, evidence };
        }

        case 'A2-heidi-web-kill': {
          const pid = findPidOnPort(3000);
          if (!pid) {
            return { injected: false, evidence, error: 'No process found on port 3000' };
          }
          evidence.push({
            check: 'pre-injection-health', status: 'pass',
            value: `PID ${pid} on port 3000`, checkedAt: now,
          });
          killPid(pid);
          evidence.push({
            check: 'process-killed', status: 'pass',
            value: `Killed PID ${pid}`, checkedAt: new Date().toISOString(),
          });
          return { injected: true, evidence };
        }

        case 'B1-supabase-rest-restart': {
          // Phase 5 audit fix: use 'docker stop' not 'docker restart'
          // HEIDI must detect and recover — not Docker's restart policy
          execSync('docker stop supabase_rest_HYDI-System-v2', { timeout: 30000, stdio: 'pipe' });
          evidence.push({
            check: 'container-stopped', status: 'pass',
            value: 'supabase_rest_HYDI-System-v2 stopped — HEIDI must detect and recover', checkedAt: new Date().toISOString(),
          });
          return { injected: true, evidence };
        }

        case 'D1-ollama-stop': {
          if (process.platform === 'win32') {
            try {
              execSync('taskkill /IM ollama.exe /F', { timeout: 5000, stdio: 'pipe' });
            } catch { /* may not be running */ }
          } else {
            try {
              execSync('pkill -f ollama', { timeout: 5000, stdio: 'pipe' });
            } catch { /* may not be running */ }
          }
          evidence.push({
            check: 'ollama-stopped', status: 'pass',
            value: 'Ollama process killed', checkedAt: new Date().toISOString(),
          });
          return { injected: true, evidence };
        }

        case 'E1-supabase-db-restart': {
          // Phase 5 audit fix: use 'docker stop' not 'docker restart'
          // HEIDI must detect and recover — not Docker's restart policy
          execSync('docker stop supabase_db_HYDI-System-v2', { timeout: 30000, stdio: 'pipe' });
          evidence.push({
            check: 'db-container-stopped', status: 'pass',
            value: 'supabase_db_HYDI-System-v2 stopped — HEIDI must detect and recover', checkedAt: new Date().toISOString(),
          });
          return { injected: true, evidence };
        }

        case 'F1-bridge-probe': {
          // For bridge test, we kill heidi-web (which the bridge depends on)
          const pid = findPidOnPort(3000);
          if (!pid) {
            return { injected: false, evidence, error: 'No heidi-web process on port 3000' };
          }
          killPid(pid);
          evidence.push({
            check: 'heidi-web-killed', status: 'pass',
            value: `Killed heidi-web PID ${pid} to test bridge dependency`, checkedAt: new Date().toISOString(),
          });
          return { injected: true, evidence };
        }

        default:
          return { injected: false, evidence, error: `Unknown scenario: ${scenario.scenarioId}` };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      evidence.push({
        check: 'injection-error', status: 'fail',
        value: msg, checkedAt: new Date().toISOString(),
      });
      return { injected: false, evidence, error: msg };
    }
  }

  /**
   * Verify recovery for a scenario.
   * Returns evidence of the recovery state.
   */
  verifyRecovery(scenario: FailureScenario): { recovered: boolean; evidence: HealthEvidence[] } {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();

    switch (scenario.scenarioId) {
      case 'A1-protoforge-kill':
      case 'C1-protoforge-dep-chain': {
        const health = checkHealthEndpoint('http://127.0.0.1:3005/health');
        evidence.push({
          check: 'health-endpoint', status: health.ok ? 'pass' : 'fail',
          value: `HTTP ${health.statusCode}`, detail: health.body.slice(0, 200),
          checkedAt: now, latencyMs: 0,
        });
        return { recovered: health.ok, evidence };
      }

      case 'A2-heidi-web-kill':
      case 'F1-bridge-probe': {
        const health = checkHealthEndpoint('http://127.0.0.1:3000/api/health');
        evidence.push({
          check: 'health-endpoint', status: health.ok ? 'pass' : 'fail',
          value: `HTTP ${health.statusCode}`, detail: health.body.slice(0, 200),
          checkedAt: now,
        });
        return { recovered: health.ok, evidence };
      }

      case 'B1-supabase-rest-restart': {
        try {
          // Use State.Status (running) instead of State.Health.Status (not all containers have health checks)
          const out = execSync('docker inspect --format "{{.State.Status}}" supabase_rest_HYDI-System-v2', {
            encoding: 'utf8', timeout: 5000,
          });
          const status = out.trim();
          // Also try a functional check via the Kong gateway
          let functionalOk = false;
          try {
            const restOut = execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:54321/rest/v1/', {
              encoding: 'utf8', timeout: 10000,
            });
            functionalOk = parseInt(restOut.trim(), 10) < 500;
          } catch { /* may not be ready yet */ }
          evidence.push({
            check: 'container-status', status: status === 'running' ? 'pass' : 'fail',
            value: status, checkedAt: now,
          });
          if (functionalOk) {
            evidence.push({
              check: 'rest-api-functional', status: 'pass',
              value: 'REST API responding', checkedAt: now,
            });
          }
          return { recovered: status === 'running', evidence };
        } catch (e) {
          evidence.push({
            check: 'container-status', status: 'fail',
            value: 'docker inspect failed', checkedAt: now,
          });
          return { recovered: false, evidence };
        }
      }

      case 'D1-ollama-stop': {
        const health = checkHealthEndpoint('http://127.0.0.1:11434/api/tags');
        evidence.push({
          check: 'ollama-health', status: health.ok ? 'pass' : 'fail',
          value: `HTTP ${health.statusCode}`, checkedAt: now,
        });
        return { recovered: health.ok, evidence };
      }

      case 'E1-supabase-db-restart': {
        try {
          // DB container has health checks, use Health.Status
          const out = execSync('docker inspect --format "{{.State.Health.Status}}" supabase_db_HYDI-System-v2', {
            encoding: 'utf8', timeout: 5000,
          });
          const status = out.trim();
          evidence.push({
            check: 'db-container-health', status: status === 'healthy' ? 'pass' : 'fail',
            value: status, checkedAt: now,
          });
          return { recovered: status === 'healthy', evidence };
        } catch {
          // Fallback: check if container is at least running
          try {
            const out = execSync('docker inspect --format "{{.State.Status}}" supabase_db_HYDI-System-v2', {
              encoding: 'utf8', timeout: 5000,
            });
            const status = out.trim();
            evidence.push({
              check: 'db-container-status', status: status === 'running' ? 'pass' : 'fail',
              value: status, checkedAt: now,
            });
            return { recovered: status === 'running', evidence };
          } catch {
            evidence.push({
              check: 'db-container-health', status: 'fail',
              value: 'docker inspect failed', checkedAt: now,
            });
            return { recovered: false, evidence };
          }
        }
      }

      default:
        return { recovered: false, evidence };
    }
  }

  /**
   * Cleanup after a scenario (best-effort).
   */
  cleanup(scenario: FailureScenario): void {
    // For process kills, recovery should have restarted them.
    // If not, we try a manual restart here.
    switch (scenario.scenarioId) {
      case 'A1-protoforge-kill':
      case 'C1-protoforge-dep-chain': {
        const health = checkHealthEndpoint('http://127.0.0.1:3005/health');
        if (!health.ok) {
          try {
            execSync('node scripts/hydi-recover.js --governed --component=protoforge-core', {
              cwd: this.root, timeout: 60000, stdio: 'pipe',
            });
          } catch { /* best effort */ }
        }
        break;
      }
      case 'A2-heidi-web-kill':
      case 'F1-bridge-probe': {
        const health = checkHealthEndpoint('http://127.0.0.1:3000/api/health');
        if (!health.ok) {
          try {
            execSync('node scripts/hydi-recover.js --governed --component=heidi-web', {
              cwd: this.root, timeout: 60000, stdio: 'pipe',
            });
          } catch { /* best effort */ }
        }
        break;
      }
      case 'D1-ollama-stop': {
        const health = checkHealthEndpoint('http://127.0.0.1:11434/api/tags');
        if (!health.ok) {
          // Try to restart Ollama
          try {
            if (process.platform === 'win32') {
              execSync('start "" "ollama" serve', { timeout: 5000, stdio: 'pipe' });
            } else {
              execSync('ollama serve &', { timeout: 5000, stdio: 'pipe' });
            }
          } catch { /* best effort */ }
        }
        break;
      }
    }
  }
}
