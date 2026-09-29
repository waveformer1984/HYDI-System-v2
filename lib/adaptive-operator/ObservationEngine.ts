/**
 * HYDI Observation Engine
 *
 * Collects observations from the real environment using the existing
 * HumanActionEngine adapters. Does NOT execute actions — only observes.
 *
 * Observations are stored in the WorldStateManager.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';
import https from 'https';
import { randomUUID } from 'crypto';
import { lookup as dnsLookupCb } from 'dns';
import { resolveHealthProbeTarget, PRIVATE_HOSTNAME } from '../human-action/adapters/HttpAdapter';
import { authorizeFilesystemTarget } from '../human-action/FilesystemAuthorization';

import type {
  Observation,
  ObservationCategory,
  ObservationResult,
  ObservationRequest,
  WorldState,
} from './AdaptiveOperatorTypes';
import type { WorldStateManager } from './WorldStateManager';
import type { HumanActionEngine } from '../human-action/HumanActionEngine';
import type { ActionCapabilityRegistry } from '../human-action/ActionCapabilityRegistry';

const execFile = promisify(execFileCb);
const dnsLookupAsync = promisify(dnsLookupCb);

/**
 * A process image/name token for tasklist/pgrep — anything that could break
 * out of a single argument (spaces, quotes, metacharacters) is refused, so a
 * caller-controlled process name can never inject a second command.
 */
const SAFE_PROCESS_NAME = /^[A-Za-z0-9._-]{1,128}$/;

export class ObservationEngine {
  constructor(
    private worldStateManager: WorldStateManager,
    private registry: ActionCapabilityRegistry,
    private rootDir: string,
  ) { }

  /**
   * Observe the environment based on a request.
   * Uses cached observations if fresh enough.
   */
  async observe(request: ObservationRequest): Promise<ObservationResult> {
    // Check cache first
    const cacheKey = this.makeKey(request.category, request.target);
    if (request.freshnessRequired) {
      const cached = this.worldStateManager.get(cacheKey);
      if (cached) {
        const age = Date.now() - new Date(cached.timestamp).getTime();
        if (age <= request.freshnessRequired * 1000) {
          return { success: true, observation: cached, fromCache: true };
        }
      }
    }

    try {
      let observation: Observation | null = null;

      switch (request.category) {
        case 'process':
          observation = await this.observeProcess(request.target, request.correlationId);
          break;
        case 'port':
          observation = await this.observePort(request.target, request.correlationId);
          break;
        case 'file':
          observation = await this.observeFile(request.target, request.correlationId);
          break;
        case 'service':
          observation = await this.observeService(request.target, request.correlationId);
          break;
        case 'repository':
        case 'git_state':
          observation = await this.observeGitState(request.target, request.correlationId);
          break;
        case 'api':
          observation = await this.observeApi(request.target, request.correlationId);
          break;
        case 'credential':
          observation = await this.observeCredential(request.target, request.correlationId);
          break;
        case 'capability_health':
          observation = await this.observeCapabilityHealth(request.target, request.correlationId);
          break;
        case 'health':
          observation = await this.observeHealth(request.target, request.correlationId);
          break;
        case 'network':
          observation = await this.observeNetwork(request.target, request.correlationId);
          break;
        case 'environment':
          observation = await this.observeEnvironment(request.target, request.correlationId);
          break;
        default:
          return { success: false, error: `Unsupported observation category: ${request.category}` };
      }

      if (observation) {
        this.worldStateManager.observe(observation);
        return { success: true, observation };
      }
      return { success: false, error: 'Observation returned null' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Observe multiple targets in parallel.
   */
  async observeAll(requests: ObservationRequest[]): Promise<ObservationResult[]> {
    return Promise.all(requests.map((r) => this.observe(r)));
  }

  /**
   * Perform an initial environmental scan for a goal.
   */
  async scanEnvironment(correlationId: string): Promise<Observation[]> {
    const requests: ObservationRequest[] = [
      { category: 'environment', target: 'node_version', correlationId },
      { category: 'environment', target: 'platform', correlationId },
      { category: 'environment', target: 'cwd', correlationId },
      { category: 'git_state', target: this.rootDir, correlationId },
      { category: 'capability_health', target: 'all', correlationId },
    ];

    const results = await this.observeAll(requests);
    return results
      .filter((r) => r.success && r.observation)
      .map((r) => r.observation!);
  }

  // -----------------------------------------------------------------------
  // Specific observation implementations
  // -----------------------------------------------------------------------

  private async observeProcess(target: string, correlationId: string): Promise<Observation> {
    try {
      // On Windows, use tasklist; on Linux, use pgrep. The target is caller-
      // influenced, so it goes through execFile as a literal argv entry (no
      // shell) AND is restricted to a bare process-name token — a name like
      // `x" & whoami` is refused rather than interpolated into a shell string.
      if (!SAFE_PROCESS_NAME.test(target)) {
        throw new Error(`Unsafe process name: ${target}`);
      }
      const { stdout } = process.platform === 'win32'
        ? await execFile('tasklist', ['/FI', `IMAGENAME eq ${target}*`, '/FO', 'CSV', '/NH'], { timeout: 5000, windowsHide: true })
        : await execFile('pgrep', ['-i', '-l', '-f', target], { timeout: 5000 });
      const lines = stdout.trim().split('\n').filter((l) => l.trim());
      const exists = lines.length > 0;
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'process',
        confidence: 0.9,
        freshness: 'current',
        correlationId,
        category: 'process',
        key: `process:${target}`,
        value: { exists, count: lines.length, details: lines.slice(0, 5) },
        summary: `Process ${target}: ${exists ? `${lines.length} instances` : 'not running'}`,
      };
    } catch (error) {
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'process',
        confidence: 0.5,
        freshness: 'current',
        correlationId,
        category: 'process',
        key: `process:${target}`,
        value: { exists: false, error: error instanceof Error ? error.message : 'unknown' },
        summary: `Process ${target}: not running (or check failed)`,
      };
    }
  }

  private async observePort(target: string, correlationId: string): Promise<Observation> {
    const port = parseInt(target, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${target}`);
    }
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      let resolved = false;

      const done = (inUse: boolean, pid?: string) => {
        if (resolved) return;
        resolved = true;
        socket.destroy();
        resolve({
          observationId: randomUUID(),
          timestamp: new Date().toISOString(),
          source: 'network',
          confidence: 0.95,
          freshness: 'current',
          correlationId,
          category: 'port',
          key: `port:${port}`,
          value: { port, inUse, pid },
          summary: `Port ${port}: ${inUse ? 'in use' : 'available'}`,
        });
      };

      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false));
      socket.on('error', () => done(false));
      socket.connect(port, '127.0.0.1');
    });
  }

  private async observeFile(target: string, correlationId: string): Promise<Observation> {
    try {
      // Read authorization (red-team 2026-09-18): bare fs.statSync on any
      // path was a protected-file existence/size oracle — stat `.env` or
      // `.ssh/id_rsa` and learn exactly what the secret store contains.
      // Route the target through the same filesystem authorization the
      // write path uses (read scope): confined to the repo root, secrets and
      // VCS internals refused.
      const auth = authorizeFilesystemTarget(target, {
        operation: 'read',
        repoRoot: this.rootDir,
        allowedTargets: [{ type: 'glob', pattern: '**' }],
      });
      if (!auth.allowed || !auth.resolvedPath) {
        return {
          observationId: randomUUID(),
          timestamp: new Date().toISOString(),
          source: 'filesystem',
          confidence: 1.0,
          freshness: 'current',
          correlationId,
          category: 'file',
          key: `file:${target}`,
          value: { exists: null, refused: true, code: auth.code },
          summary: `File ${target}: observation refused (${auth.code})`,
        };
      }
      const stats = fs.statSync(auth.resolvedPath);
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'filesystem',
        confidence: 1.0,
        freshness: 'current',
        correlationId,
        category: 'file',
        key: `file:${target}`,
        value: {
          exists: true,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          modified: stats.mtime.toISOString(),
        },
        summary: `File ${target}: exists (${stats.isDirectory() ? 'directory' : 'file'}, ${stats.size} bytes)`,
      };
    } catch {
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'filesystem',
        confidence: 1.0,
        freshness: 'current',
        correlationId,
        category: 'file',
        key: `file:${target}`,
        value: { exists: false },
        summary: `File ${target}: does not exist`,
      };
    }
  }

  private async observeService(target: string, correlationId: string): Promise<Observation> {
    // Check if a service is running by looking for its process and port
    const [processObs, portObs] = await Promise.all([
      this.observeProcess(target, correlationId),
      // Common service ports
      target.includes('3000') ? this.observePort('3000', correlationId) : Promise.resolve(null),
    ]);

    const processRunning = (processObs.value as { exists: boolean }).exists;
    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'process',
      confidence: 0.8,
      freshness: 'current',
      correlationId,
      category: 'service',
      key: `service:${target}`,
      value: { running: processRunning, process: processObs.value, port: portObs?.value },
      summary: `Service ${target}: ${processRunning ? 'running' : 'not running'}`,
    };
  }

  /**
   * Confine an observation working directory to the engine's rootDir — a
   * caller-controlled cwd would let the fixed git commands probe (and the
   * adapter's commit path write into) an unrelated tree.
   */
  private resolveInsideRoot(target: string | undefined): string {
    const raw = target ?? this.rootDir;
    let resolved = path.resolve(raw);
    try {
      if (fs.existsSync(resolved)) resolved = fs.realpathSync(resolved);
    } catch { /* keep unresolved form; boundary check below still applies */ }
    const realRoot = fs.existsSync(this.rootDir) ? fs.realpathSync(this.rootDir) : this.rootDir;
    const rel = path.relative(realRoot, resolved);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`target escapes the observation root: ${resolved}`);
    }
    return resolved;
  }

  private async observeGitState(target: string, correlationId: string): Promise<Observation> {
    try {
      const cwd = this.resolveInsideRoot(target);
      const { stdout: status } = await execFile('git', ['status', '--porcelain'], { cwd, timeout: 5000, windowsHide: true });
      const { stdout: branch } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000, windowsHide: true });
      const { stdout: commit } = await execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd, timeout: 5000, windowsHide: true });
      const changedFiles = status.trim().split('\n').filter((l) => l.trim());
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'git',
        confidence: 1.0,
        freshness: 'current',
        correlationId,
        category: 'git_state',
        key: `git_state:${target}`,
        value: {
          isRepo: true,
          branch: branch.trim(),
          commit: commit.trim(),
          changedFiles: changedFiles.length,
          clean: changedFiles.length === 0,
        },
        summary: `Git: ${branch.trim()} @ ${commit.trim()}, ${changedFiles.length} changes`,
      };
    } catch {
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'git',
        confidence: 0.9,
        freshness: 'current',
        correlationId,
        category: 'git_state',
        key: `git_state:${target}`,
        value: { isRepo: false },
        summary: `Not a git repository: ${target}`,
      };
    }
  }

  private async observeApi(target: string, correlationId: string): Promise<Observation> {
    try {
      // Egress gate (red-team 2026-09-18): this path fetched ANY URL and
      // returned a 500-char bodyPreview — full response-body exfiltration of
      // cloud metadata/internal endpoints, bypassing the network.http_request
      // SSRF floor entirely. Now: the destination must be loopback (the
      // managed system itself — the legitimate health-check target) or pass
      // the same private/metadata/internal refusal as http_request; the
      // socket is pinned to the resolved IP; and the body is NEVER returned
      // — only its length, so this cannot be turned into a read oracle.
      const { urlObj, resolvedIp } = await resolveHealthProbeTarget(target);
      const isHttps = urlObj.protocol === 'https:';
      const reqModule = isHttps ? https : http;
      const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);
      return await new Promise<Observation>((resolve) => {
        const start = Date.now();
        const req = reqModule.request(
          {
            hostname: resolvedIp,
            port,
            path: `${urlObj.pathname}${urlObj.search}`,
            method: 'GET',
            headers: { Host: urlObj.host },
            timeout: 10000,
            ...(isHttps ? { servername: urlObj.hostname } : {}),
          },
          (res) => {
            let bodyLength = 0;
            res.on('data', (chunk) => { bodyLength += chunk.length; });
            res.on('end', () => {
              resolve({
                observationId: randomUUID(),
                timestamp: new Date().toISOString(),
                source: 'api',
                confidence: 0.95,
                freshness: 'current',
                correlationId,
                category: 'api',
                key: `api:${target}`,
                value: {
                  reachable: true,
                  statusCode: res.statusCode,
                  latencyMs: Date.now() - start,
                  bodyLength,
                },
                summary: `API ${target}: HTTP ${res.statusCode} (${Date.now() - start}ms)`,
              });
            });
          },
        );
        req.on('error', () => {
          resolve({
            observationId: randomUUID(),
            timestamp: new Date().toISOString(),
            source: 'api',
            confidence: 0.9,
            freshness: 'current',
            correlationId,
            category: 'api',
            key: `api:${target}`,
            value: { reachable: false },
            summary: `API ${target}: unreachable`,
          });
        });
        req.on('timeout', () => {
          req.destroy();
          resolve({
            observationId: randomUUID(),
            timestamp: new Date().toISOString(),
            source: 'api',
            confidence: 0.9,
            freshness: 'current',
            correlationId,
            category: 'api',
            key: `api:${target}`,
            value: { reachable: false, timeout: true },
            summary: `API ${target}: timeout`,
          });
        });
        req.end();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid URL';
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'api',
        confidence: 0.5,
        freshness: 'current',
        correlationId,
        category: 'api',
        key: `api:${target}`,
        value: { reachable: false, refused: true, error: message },
        summary: `API ${target}: ${message}`,
      };
    }
  }

  private async observeCredential(target: string, correlationId: string): Promise<Observation> {
    // Use the credential adapter to check credential health
    const caps = this.registry.listByCategory('CREDENTIALS');
    const hasCredentialAdapter = caps.some((c) => c.status === 'AVAILABLE');
    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'credential',
      confidence: hasCredentialAdapter ? 0.9 : 0.3,
      freshness: 'current',
      correlationId,
      category: 'credential',
      key: `credential:${target}`,
      value: {
        adapterAvailable: hasCredentialAdapter,
        capabilityCount: caps.length,
      },
      summary: `Credentials: ${hasCredentialAdapter ? 'adapter available' : 'no adapter'}, ${caps.length} capabilities`,
    };
  }

  private async observeCapabilityHealth(target: string, correlationId: string): Promise<Observation> {
    const allCaps = this.registry.describeCapabilities();
    const available = allCaps.filter((c) => c.status === 'AVAILABLE').length;
    const blocked = allCaps.filter((c) => c.status === 'BLOCKED').length;
    const unsupported = allCaps.filter((c) => c.status === 'UNSUPPORTED').length;
    const requiresAuth = allCaps.filter((c) => c.status === 'REQUIRES_AUTHORIZATION').length;
    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'capability',
      confidence: 1.0,
      freshness: 'current',
      correlationId,
      category: 'capability_health',
      key: `capability_health:${target}`,
      value: { total: allCaps.length, available, blocked, unsupported, requiresAuth },
      summary: `Capabilities: ${available}/${allCaps.length} available, ${blocked} blocked, ${unsupported} unsupported`,
    };
  }

  private async observeHealth(target: string, correlationId: string): Promise<Observation> {
    const apiObs = await this.observeApi(target, correlationId);
    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'health',
      confidence: apiObs.confidence,
      freshness: 'current',
      correlationId,
      category: 'health',
      key: `health:${target}`,
      value: apiObs.value,
      summary: `Health ${target}: ${(apiObs.value as { statusCode?: number }).statusCode ?? 'unknown'}`,
    };
  }

  private async observeNetwork(target: string, correlationId: string): Promise<Observation> {
    // Internal-name floor: resolving `*.internal` / localhost-style names is
    // internal recon, same refusal as network.dns_lookup.
    if (!target || PRIVATE_HOSTNAME.test(target)) {
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'network',
        confidence: 0.9,
        freshness: 'current',
        correlationId,
        category: 'network',
        key: `network:${target}`,
        value: { resolved: false, refused: true },
        summary: `Network: ${target} refused (internal hostname)`,
      };
    }
    // DNS lookup
    try {
      const result = await dnsLookupAsync(target);
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'network',
        confidence: 0.95,
        freshness: 'current',
        correlationId,
        category: 'network',
        key: `network:${target}`,
        value: { resolved: true, address: result.address },
        summary: `Network: ${target} resolves to ${result.address}`,
      };
    } catch {
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'network',
        confidence: 0.9,
        freshness: 'current',
        correlationId,
        category: 'network',
        key: `network:${target}`,
        value: { resolved: false },
        summary: `Network: ${target} does not resolve`,
      };
    }
  }

  private async observeEnvironment(target: string, correlationId: string): Promise<Observation> {
    let value: unknown;
    let summary: string;
    switch (target) {
      case 'node_version':
        value = process.version;
        summary = `Node.js ${process.version}`;
        break;
      case 'platform':
        value = { platform: process.platform, arch: process.arch };
        summary = `Platform: ${process.platform}/${process.arch}`;
        break;
      case 'cwd':
        value = process.cwd();
        summary = `Working directory: ${process.cwd()}`;
        break;
      default:
        value = { unknown: target };
        summary = `Environment: ${target}`;
    }
    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'inference',
      confidence: 1.0,
      freshness: 'current',
      correlationId,
      category: 'environment',
      key: `environment:${target}`,
      value,
      summary,
    };
  }

  private makeKey(category: ObservationCategory, target: string): string {
    return `${category}:${target}`;
  }
}
