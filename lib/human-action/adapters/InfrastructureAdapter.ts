/**
 * HYDI Infrastructure Action Adapter
 *
 * Implements infrastructure operations: Docker, service restart, health check.
 * Wraps the existing DependencyAwareRestartExecutor for service restarts.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import https from 'https';
import { resolveHealthProbeTarget } from './HttpAdapter';
import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

const execFile = promisify(execFileCb);

/**
 * Docker container/name token charset. A container name is interpolated into a
 * docker argv, so it is restricted to the characters Docker itself permits —
 * this keeps shell metacharacters (`;`, `&`, `|`, spaces) out even though we
 * run via execFile (no shell), defence-in-depth against any future caller
 * that reintroduces string interpolation.
 */
const DOCKER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/;

export interface InfrastructureAdapterDeps {
  restartService?: (target: string, reason: string) => Promise<{ restarted: boolean; healthy: boolean; evidence: string }>;
}

export class InfrastructureAdapter implements ActionAdapter {
  adapterId = 'infrastructure';
  category = 'INFRASTRUCTURE' as const;
  capabilities = [
    'infra.docker_operation',
    'infra.service_restart',
    'infra.health_check',
  ];

  constructor(private deps: InfrastructureAdapterDeps = {}) { }

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'infra.docker_operation': {
          const operation = (action.parameters.operation as string) ?? 'ps';
          const container = action.target;
          const allowedOps = ['ps', 'logs', 'inspect', 'stats'];
          if (!allowedOps.includes(operation)) {
            throw new Error(`Docker operation '${operation}' not allowed. Allowed: [${allowedOps.join(', ')}]`);
          }
          // Container name is caller-controlled — it becomes a literal execFile
          // argv entry (no shell), and is restricted to Docker's name charset
          // so it can never carry shell metacharacters.
          if (container && operation !== 'ps' && !DOCKER_NAME.test(container)) {
            throw new Error(`Invalid docker container name: '${container}'`);
          }
          const args = container && operation !== 'ps' ? [operation, container] : [operation];
          const { stdout } = await execFile('docker', args, { timeout: 15000, windowsHide: true });
          output = { output: stdout.slice(0, 5000) };
          evidence.push({
            check: 'docker_operation',
            status: 'pass',
            value: `docker ${operation} completed`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'infra.service_restart': {
          if (!this.deps.restartService) {
            return {
              executed: false, output: null,
              error: 'Service restart is not configured (no DependencyAwareRestartExecutor)',
              evidence: [{
                check: 'restart_available',
                status: 'fail',
                value: 'No restart executor configured',
                checkedAt: new Date().toISOString(),
              }],
              durationMs: Date.now() - startTime,
            };
          }
          const target = action.target;
          const reason = (action.parameters.reason as string) ?? 'Human action engine request';
          const result = await this.deps.restartService(target, reason);
          output = result;
          evidence.push({
            check: 'service_restart',
            status: result.restarted ? 'pass' : 'fail',
            value: result.evidence,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'infra.health_check': {
          const url = action.target;
          const result = await this.healthCheck(url, action.timeoutMs ?? 10000);
          output = result;
          evidence.push({
            check: 'health_check',
            status: result.healthy ? 'pass' : 'fail',
            value: `HTTP ${result.statusCode}: ${result.healthy ? 'healthy' : 'unhealthy'}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        default:
          return {
            executed: false, output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [], durationMs: Date.now() - startTime,
          };
      }

      return {
        executed: true, output, error: null, evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        executed: false, output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [{
          check: 'execution_error',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
      };
    }
  }

  async verify(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<ActionVerificationResult> {
    const evidence: ActionVerificationResult['evidence'] = [];
    if (!executionResult.executed) {
      return { verified: false, evidence, reason: 'Action was not executed' };
    }

    if (action.capability === 'infra.service_restart') {
      const output = executionResult.output as { restarted: boolean; healthy: boolean };
      evidence.push({
        check: 'service_healthy',
        status: output.healthy ? 'pass' : 'fail',
        value: output.healthy ? 'Service healthy after restart' : 'Service unhealthy after restart',
        checkedAt: new Date().toISOString(),
      });
      return {
        verified: output.healthy,
        evidence,
        reason: output.healthy ? 'Service verified healthy' : 'Service not healthy',
      };
    }

    if (action.capability === 'infra.health_check') {
      const output = executionResult.output as { healthy: boolean; statusCode: number };
      evidence.push({
        check: 'health_status',
        status: output.healthy ? 'pass' : 'fail',
        value: `Status: ${output.healthy ? 'healthy' : 'unhealthy'}`,
        checkedAt: new Date().toISOString(),
      });
      return {
        verified: output.healthy,
        evidence,
        reason: output.healthy ? 'Service verified healthy' : 'Service not healthy',
      };
    }

    const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
    return {
      verified: hasPass,
      evidence,
      reason: hasPass ? 'Operation verified' : 'Verification failed',
    };
  }

  async rollback(
    _action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    return { attempted: false, succeeded: false, evidence: 'Infrastructure operations have no automatic rollback', error: 'Not reversible' };
  }

  isAvailable(): { available: boolean; reason: string | null } {
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    try {
      const result = await this.healthCheck(target, 5000);
      return {
        target,
        exists: result.statusCode > 0,
        state: result.healthy ? 'healthy' : 'unhealthy',
        properties: { statusCode: result.statusCode },
        observedAt: new Date().toISOString(),
      };
    } catch {
      return {
        target, exists: false, state: 'unreachable',
        properties: {}, observedAt: new Date().toISOString(),
      };
    }
  }

  private async healthCheck(url: string, timeoutMs: number): Promise<{
    healthy: boolean;
    statusCode: number;
    latencyMs: number;
  }> {
    const start = Date.now();
    // Egress gate (red-team 2026-09-18): `new URL(url)` + bare http.get was an
    // ungated SSRF/port-scan oracle — the status code alone leaked whether
    // cloud-metadata/internal endpoints were reachable. Same policy as
    // ObservationEngine.observeApi: loopback (the managed system) allowed,
    // private/metadata/internal refused, socket pinned to the resolved IP.
    let target: { urlObj: URL; resolvedIp: string };
    try {
      target = await resolveHealthProbeTarget(url);
    } catch {
      return { healthy: false, statusCode: 0, latencyMs: Date.now() - start };
    }
    return new Promise((resolve) => {
      try {
        const { urlObj, resolvedIp } = target;
        const isHttps = urlObj.protocol === 'https:';
        const reqModule = isHttps ? https : http;
        const req = reqModule.get(
          {
            hostname: resolvedIp,
            port: urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80),
            path: `${urlObj.pathname}${urlObj.search}`,
            headers: { Host: urlObj.host },
            timeout: timeoutMs,
            ...(isHttps ? { servername: urlObj.hostname } : {}),
          },
          (res) => {
            resolve({
              healthy: res.statusCode !== undefined && res.statusCode < 400,
              statusCode: res.statusCode ?? 0,
              latencyMs: Date.now() - start,
            });
            res.resume();
          });
        req.on('error', () => {
          resolve({ healthy: false, statusCode: 0, latencyMs: Date.now() - start });
        });
        req.on('timeout', () => {
          req.destroy();
          resolve({ healthy: false, statusCode: 0, latencyMs: Date.now() - start });
        });
      } catch {
        resolve({ healthy: false, statusCode: 0, latencyMs: Date.now() - start });
      }
    });
  }
}
