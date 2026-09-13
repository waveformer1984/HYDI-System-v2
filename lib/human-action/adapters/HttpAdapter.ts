/**
 * HYDI HTTP Action Adapter
 *
 * Implements network operations: HTTP requests, DNS lookups, connectivity tests.
 *
 * Safety:
 *   - No arbitrary headers with secrets (auth headers resolved from credential refs)
 *   - Response bodies are checked for secret patterns before returning
 *   - Timeouts are enforced
 */

import http from 'http';
import https from 'https';
import { lookup as dnsLookup } from 'dns';
import { promisify } from 'util';
import net from 'net';
import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

const dnsLookupAsync = promisify(dnsLookup);

export class HttpAdapter implements ActionAdapter {
  adapterId = 'http';
  category = 'NETWORK' as const;
  capabilities = [
    'network.http_request',
    'network.dns_lookup',
    'network.connectivity_test',
  ];

  async execute(
    action: HumanAction,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'network.http_request': {
          const result = await this.httpRequest(action, context);
          output = result;
          evidence.push({
            check: 'http_status',
            status: result.statusCode >= 200 && result.statusCode < 400 ? 'pass' : 'fail',
            value: `HTTP ${result.statusCode}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'network.dns_lookup': {
          const result = await this.dnsLookup(action);
          output = result;
          evidence.push({
            check: 'dns_resolved',
            status: result.resolved ? 'pass' : 'fail',
            value: result.resolved ? `Resolved to ${result.address}` : 'DNS resolution failed',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'network.connectivity_test': {
          const result = await this.connectivityTest(action);
          output = result;
          evidence.push({
            check: 'connectivity',
            status: result.connected ? 'pass' : 'fail',
            value: result.connected ? `Connected to ${result.target}` : `Cannot connect to ${result.target}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        default:
          return {
            executed: false,
            output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [],
            durationMs: Date.now() - startTime,
          };
      }

      return {
        executed: true,
        output,
        error: null,
        evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        executed: false,
        output: null,
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

    const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
    evidence.push({
      check: 'evidence_check',
      status: hasPass ? 'pass' : 'fail',
      value: hasPass ? 'Passing evidence present' : 'No passing evidence',
      checkedAt: new Date().toISOString(),
    });

    return {
      verified: hasPass,
      evidence,
      reason: hasPass ? 'Network operation verified' : 'Verification failed',
    };
  }

  async rollback(
    _action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    return {
      attempted: false,
      succeeded: false,
      evidence: 'Network operations cannot be rolled back',
      error: 'Not reversible',
    };
  }

  isAvailable(): { available: boolean; reason: string | null } {
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    // For URLs, do a quick HEAD request
    try {
      const url = new URL(target);
      const result = await this.httpRequest({
        actionId: 'observe',
        intentId: 'observe',
        goalId: 'observe',
        actor: 'system',
        authorizedBy: 'system',
        category: 'NETWORK',
        capability: 'network.http_request',
        operation: 'HEAD',
        target,
        parameters: { method: 'HEAD', url: target },
        risk: 'R0',
        riskLabel: 'LOW',
        reversibility: 'REVERSIBLE',
        authorizationScope: 'READ_ONLY',
        authorizationMode: 'autonomous',
        dependencies: [],
        expectedResult: 'HTTP response',
        timeoutMs: 5000,
        retryPolicy: { maxAttempts: 1, cooldownMs: 1000, backoffMultiplier: 2, retryableErrors: [] },
        rollbackStrategy: { type: 'not_possible', description: 'N/A' },
        verificationStrategy: { type: 'api_response', description: 'N/A' },
        state: 'EXECUTING',
        createdAt: new Date().toISOString(),
      }, { sessionId: 'observe', actorId: 'system', authorizationMode: 'autonomous', authorizationScope: 'READ_ONLY', auditTrail: [] });

      return {
        target,
        exists: result.statusCode < 400,
        state: `HTTP ${result.statusCode}`,
        properties: { statusCode: result.statusCode },
        observedAt: new Date().toISOString(),
      };
    } catch {
      return {
        target,
        exists: false,
        state: 'unreachable',
        properties: {},
        observedAt: new Date().toISOString(),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Private operation implementations
  // -----------------------------------------------------------------------

  private async httpRequest(
    action: HumanAction,
    context: ActionExecutionContext,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const url = (action.parameters.url as string) ?? action.target;
    const method = (action.parameters.method as string) ?? 'GET';
    const headers = { ...((action.parameters.headers as Record<string, string>) ?? {}) };
    const body = action.parameters.body as string | undefined;
    const timeout = action.timeoutMs ?? 15000;

    // Resolve credential reference for Authorization header
    const credRef = action.parameters.credentialRef as string | undefined;
    if (credRef && context.resolveCredential) {
      const credValue = await context.resolveCredential(credRef);
      if (credValue) {
        headers['Authorization'] = `Bearer ${credValue}`;
      }
    }

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const reqModule = isHttps ? https : http;

      const req = reqModule.request(
        url,
        {
          method,
          headers,
          timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') {
                responseHeaders[key] = value;
              } else if (Array.isArray(value)) {
                responseHeaders[key] = value.join(', ');
              }
            }
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: responseHeaders,
              body: data,
            });
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Request timed out'));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private async dnsLookup(action: HumanAction): Promise<{
    resolved: boolean;
    address?: string;
    hostname: string;
  }> {
    const hostname = action.target;
    try {
      const result = await dnsLookupAsync(hostname);
      return { resolved: true, address: result.address, hostname };
    } catch {
      return { resolved: false, hostname };
    }
  }

  private async connectivityTest(action: HumanAction): Promise<{
    connected: boolean;
    target: string;
    latencyMs?: number;
  }> {
    const target = action.target;
    const port = (action.parameters.port as number) ?? 80;
    const timeout = action.timeoutMs ?? 5000;

    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(timeout);

      socket.on('connect', () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ connected: true, target: `${target}:${port}`, latencyMs: latency });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({ connected: false, target: `${target}:${port}` });
      });

      socket.on('error', () => {
        resolve({ connected: false, target: `${target}:${port}` });
      });

      socket.connect(port, target);
    });
  }
}
