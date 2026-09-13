/**
 * HYDI Observation Engine
 *
 * Collects observations from the real environment using the existing
 * HumanActionEngine adapters. Does NOT execute actions — only observes.
 *
 * Observations are stored in the WorldStateManager.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';
import https from 'https';
import { randomUUID } from 'crypto';

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

const exec = promisify(execCb);

export class ObservationEngine {
  constructor(
    private worldStateManager: WorldStateManager,
    private registry: ActionCapabilityRegistry,
    private rootDir: string,
  ) {}

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
      // On Windows, use tasklist; on Linux, use ps
      const isWindows = process.platform === 'win32';
      const cmd = isWindows
        ? `tasklist /FI "IMAGENAME eq ${target}*" /FO CSV /NH 2>nul`
        : `ps aux | grep -i ${target} | grep -v grep`;
      const { stdout } = await exec(cmd, { timeout: 5000 });
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
    if (isNaN(port)) {
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
      const stats = fs.statSync(target);
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

  private async observeGitState(target: string, correlationId: string): Promise<Observation> {
    try {
      const { stdout: status } = await exec('git status --porcelain', { cwd: target, timeout: 5000 });
      const { stdout: branch } = await exec('git rev-parse --abbrev-ref HEAD', { cwd: target, timeout: 5000 });
      const { stdout: commit } = await exec('git rev-parse --short HEAD', { cwd: target, timeout: 5000 });
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
      const url = new URL(target);
      const reqModule = url.protocol === 'https:' ? https : http;
      return new Promise((resolve) => {
        const start = Date.now();
        const req = reqModule.get(target, { timeout: 10000 }, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
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
                bodyLength: body.length,
                bodyPreview: body.slice(0, 500),
              },
              summary: `API ${target}: HTTP ${res.statusCode} (${Date.now() - start}ms)`,
            });
          });
        });
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
      });
    } catch {
      return {
        observationId: randomUUID(),
        timestamp: new Date().toISOString(),
        source: 'api',
        confidence: 0.5,
        freshness: 'current',
        correlationId,
        category: 'api',
        key: `api:${target}`,
        value: { reachable: false, error: 'Invalid URL' },
        summary: `API ${target}: invalid URL`,
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
    // DNS lookup
    try {
      const { lookup } = await import('dns');
      const lookupAsync = promisify(lookup);
      const result = await lookupAsync(target);
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
