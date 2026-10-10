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

/**
 * Egress / SSRF guard.
 * ---------------------------------------------------------------------------
 * `network.http_request` is declared R1 + `autonomous` with allowedTargets
 * `url_pattern '*'` — i.e. no destination restriction. Before this guard that
 * meant the autonomous agent could hit localhost admin endpoints, the cloud
 * metadata service (169.254.169.254), private/LAN hosts, or an arbitrary
 * attacker host with a caller-controlled body — a full SSRF + exfiltration
 * channel (red-team 2026-09-18).
 *
 * The floor enforced here, independent of any allowlist:
 *   - scheme must be http/https (no file://, gopher://, etc.)
 *   - the destination must not be loopback, private, link-local, reserved, or
 *     the cloud metadata endpoint
 *   - obvious internal hostnames are refused
 *   - the autonomous tier is read-only: GET/HEAD/OPTIONS only. A caller that
 *     needs to send a body (POST/PUT/DELETE) does not get it from an
 *     autonomous read capability — that is a higher-tier/authorized action.
 *
 * Optional tighter control: set HYDI_HTTP_EGRESS_HOSTS to a comma-separated
 * allowlist (exact host or *.suffix). When set, only those destinations are
 * permitted at all.
 */
/** Exported so ObservationEngine can apply the same internal-name floor. */
export const PRIVATE_HOSTNAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.corp|.*\.lan|.*\.home|host\.docker\.internal)$/i;

/** Exported for the egress test suite — the resolved-IP check the rebinding guard relies on. */
export function isPrivateIp(ip: string): boolean {
  // Normalise: strip [] from IPv6 literals and lowercase. Node's URL already
  // canonicalises decimal/hex/octal IPv4 (2130706433 -> 127.0.0.1), so the
  // dotted checks below cover alternate notations too.
  let h = ip.replace(/^\[|\]$/g, '').toLowerCase();
  // IPv4-mapped IPv6 in HEX form (::ffff:7f00:1) — decode the last two hex
  // groups into dotted IPv4 so the same private-range checks apply. The
  // dotted ::ffff:127.x forms are covered by the regex further below.
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    h = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // IPv4 private/loopback/link-local/reserved + CGNAT + metadata.
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;   // link-local + cloud metadata
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true; // CGNAT
  if (/^0\./.test(h) || h === '0.0.0.0') return true;
  // IPv6: loopback, link-local, ULA, unspecified, IPv4-mapped private.
  if (h === '::1' || h === '::' || /^fe80:/.test(h) || /^f[cd]/.test(h)) return true;
  if (/^::ffff:(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
  return false;
}

/** Loopback only — the set of destinations a local health probe may reach. */
export function isLoopbackIp(ip: string): boolean {
  const h = ip.replace(/^\[|\]$/g, '').toLowerCase();
  return /^127\./.test(h) || h === '::1' || /^::ffff:127\./.test(h);
}

/**
 * Resolve and clear a destination for a local health/observation probe
 * (ObservationEngine.observeApi, InfrastructureAdapter.healthCheck).
 *
 * Health probes legitimately check LOCAL services — the system under
 * management listens on loopback (ports 3000/3005/3006/11434) — so the pure
 * assertEgressAllowed floor would deny the probe's primary use. The policy
 * here is therefore: loopback destinations are permitted (they are the
 * managed system itself); EVERYTHING else must pass the same SSRF floor as
 * network.http_request — private/LAN ranges, link-local cloud metadata
 * (169.254.169.254), CGNAT, reserved space and internal hostnames are all
 * refused. The hostname is resolved once, checked, and the caller connects
 * to the returned IP so the socket cannot re-resolve to a different
 * (private) address — the same DNS-pin httpRequest uses.
 */
export async function resolveHealthProbeTarget(url: string): Promise<{ urlObj: URL; resolvedIp: string }> {
  const urlObj = new URL(url);
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    throw new Error(`health probe: scheme '${urlObj.protocol}' is not allowed — http/https only`);
  }
  const { address: resolvedIp } = await dnsLookupAsync(urlObj.hostname);
  if (isLoopbackIp(resolvedIp)) {
    return { urlObj, resolvedIp }; // managed-local target — permitted
  }
  if (PRIVATE_HOSTNAME.test(urlObj.hostname) || isPrivateIp(resolvedIp)) {
    throw new Error(`health probe: '${urlObj.hostname}' resolves to a private/internal address (${resolvedIp}) — refused (SSRF guard)`);
  }
  const list = egressAllowlist();
  if (list && !hostAllowedByList(urlObj.hostname, list)) {
    throw new Error(`health probe: destination '${urlObj.hostname}' is not in HYDI_HTTP_EGRESS_HOSTS`);
  }
  return { urlObj, resolvedIp };
}

function egressAllowlist(): string[] | null {
  const raw = process.env.HYDI_HTTP_EGRESS_HOSTS;
  if (!raw) return null;
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function hostAllowedByList(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((entry) =>
    entry.startsWith('*.') ? h === entry.slice(2) || h.endsWith(entry.slice(1)) : h === entry,
  );
}

/**
 * Exported for the network-egress test suite — this is the SSRF policy, kept
 * as a pure function so every destination class can be exercised without a
 * live socket. Throws a descriptive error for any refused destination; returns
 * undefined for an allowed one.
 */
export function assertEgressAllowed(url: string, method: string): void {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`network.http_request: scheme '${u.protocol}' is not allowed — http/https only`);
  }
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    throw new Error(`network.http_request: method '${m}' is not allowed on the autonomous read tier (GET/HEAD/OPTIONS only)`);
  }
  const host = u.hostname;
  if (!host || PRIVATE_HOSTNAME.test(host)) {
    throw new Error(`network.http_request: destination '${host}' is internal/loopback — refused (SSRF guard)`);
  }
  if (isPrivateIp(host)) {
    throw new Error(`network.http_request: destination '${host}' is a private/link-local/reserved address — refused (SSRF guard)`);
  }
  const list = egressAllowlist();
  if (list && !hostAllowedByList(host, list)) {
    throw new Error(`network.http_request: destination '${host}' is not in HYDI_HTTP_EGRESS_HOSTS`);
  }
}

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

    // SSRF / egress guard — enforces scheme, read-method, and a
    // non-internal/non-private destination before any socket is opened.
    assertEgressAllowed(url, method);

    const urlObj = new URL(url);

    // DNS-rebinding guard: resolve the hostname to an address and verify THAT
    // IP is not private/internal, then connect to the resolved IP rather than
    // re-resolving at connect time. This pins the socket to the address we
    // actually checked — a hostname that resolves to a private/metadata IP is
    // refused, and the connection cannot re-resolve to something else
    // (TOCTOU). Host/SNI keep the original hostname so vhost + TLS still work.
    const { address: resolvedIp } = await dnsLookupAsync(urlObj.hostname);
    if (isPrivateIp(resolvedIp)) {
      throw new Error(`network.http_request: '${urlObj.hostname}' resolves to a private/internal address (${resolvedIp}) — refused (SSRF guard)`);
    }

    // Resolve credential reference for Authorization header
    const credRef = action.parameters.credentialRef as string | undefined;
    if (credRef && context.resolveCredential) {
      const credValue = await context.resolveCredential(credRef);
      if (credValue) {
        headers['Authorization'] = `Bearer ${credValue}`;
      }
    }

    return new Promise((resolve, reject) => {
      const isHttps = urlObj.protocol === 'https:';
      const reqModule = isHttps ? https : http;
      const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);

      const req = reqModule.request(
        {
          // Connect to the verified IP, not the hostname — the socket cannot
          // re-resolve to a different (private) address.
          hostname: resolvedIp,
          port,
          path: `${urlObj.pathname}${urlObj.search}`,
          method,
          // Host comes LAST so a caller-supplied `headers.Host` cannot
          // override the vhost we verified — the connection goes to the
          // pinned IP and must present the host we resolved, not an
          // attacker-chosen internal vhost.
          headers: { ...headers, Host: urlObj.host },
          timeout,
          // For TLS, keep the real hostname for SNI + certificate validation.
          ...(isHttps ? { servername: urlObj.hostname } : {}),
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
    // Internal-name floor: resolving `*.internal`/localhost-style names is
    // internal recon — refused, same rule as http_request's destination check.
    if (!hostname || PRIVATE_HOSTNAME.test(hostname)) {
      return { resolved: false, hostname, error: 'refused: internal hostname' } as any;
    }
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

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { connected: false, target: `${target}:${port}`, error: 'refused: invalid port' } as any;
    }

    // Same SSRF floor as http_request — but checking the STRING is not
    // enough (red-team 2026-09-18): `2130706433`/`0x7f000001` don't match the
    // dotted-IP regexes yet resolve to 127.0.0.1, and a public-looking name
    // can resolve to a metadata/private IP. Resolve once, check the
    // RESOLVED address, and connect to that pinned IP so the socket cannot
    // re-resolve to something else (TOCTOU).
    if (!target || PRIVATE_HOSTNAME.test(target)) {
      return { connected: false, target: `${target}:${port}`, error: 'refused: internal hostname' } as any;
    }
    let resolvedIp: string;
    try {
      ({ address: resolvedIp } = await dnsLookupAsync(target));
    } catch {
      return { connected: false, target: `${target}:${port}` };
    }
    if (isPrivateIp(resolvedIp)) {
      return { connected: false, target: `${target}:${port}`, error: 'refused: resolves to private/internal address' } as any;
    }
    const list = egressAllowlist();
    if (list && !hostAllowedByList(target, list)) {
      return { connected: false, target: `${target}:${port}`, error: 'refused: not in egress allowlist' } as any;
    }

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

      // Connect to the verified IP, not the caller's hostname string.
      socket.connect(port, resolvedIp);
    });
  }
}
