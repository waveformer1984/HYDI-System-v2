/**
 * HYDI Health Provenance Checker
 *
 * Performs deep health checks that go beyond "is the port open?":
 *
 * For each component, verifies:
 *   1. Correct process is on the expected port (not a zombie or wrong service)
 *   2. Health endpoint responds with HTTP 200
 *   3. Response body is valid (not an error page)
 *   4. Dependencies are healthy
 *   5. Functional behavior (for critical components)
 *
 * Every health result includes an evidence chain (HealthEvidence[]).
 * If the checker cannot answer "why is this healthy?", state is UNKNOWN.
 *
 * A wrong process occupying the right port is reported as UNAVAILABLE,
 * not HEALTHY. This is the "no false greens" principle.
 */

import net from 'net';
import http from 'http';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import type {
  ComponentCategory,
  ComponentHealth,
  ComponentState,
  HealthEvidence,
} from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { DependencyGraph } from './types';

interface BootConfigModule {
  id: string;
  type: 'process' | 'module';
  enabled?: boolean;
  required?: boolean;
  command?: string;
  args?: string[];
  port?: number;
  health?: { url: string };
  dependsOn?: string[];
}

interface BootConfig {
  modules: BootConfigModule[];
}

export interface HealthCheckResult {
  component: string;
  state: ComponentState;
  evidence: HealthEvidence[];
  dependencies?: Record<string, ComponentState>;
  error?: string;
  category?: ComponentCategory;
  checkedAt?: string;
}

export class HealthProvenanceChecker {
  private root: string;
  private bootConfig: BootConfig;
  private stateModel: SystemStateModel;
  private graph: DependencyGraph;

  constructor(root: string, stateModel: SystemStateModel, graph: DependencyGraph) {
    this.root = root;
    this.stateModel = stateModel;
    this.graph = graph;
    this.bootConfig = this.loadBootConfig();
  }

  private loadBootConfig(): BootConfig {
    const configPath = path.resolve(this.root, 'boot.config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  /**
   * Check all components and update the state model.
   */
  async checkAll(): Promise<ComponentHealth[]> {
    // Check infrastructure components first
    const dbResult = await this.checkDatabase();
    this.stateModel.updateState(dbResult.component, dbResult.state, dbResult.evidence, dbResult.dependencies, dbResult.error);

    // Phase 6: Check supabase_db and supabase_rest as separate components
    // This is required for the governed recovery path — policies target
    // 'supabase_db' and 'supabase_rest' specifically, not 'database'.
    const supabaseDbResult = await this.checkSupabaseContainer('supabase_db', 'supabase_db_HYDI-System-v2');
    this.stateModel.updateState(supabaseDbResult.component, supabaseDbResult.state, supabaseDbResult.evidence, supabaseDbResult.dependencies, supabaseDbResult.error);

    const supabaseRestResult = await this.checkSupabaseContainer('supabase_rest', 'supabase_rest_HYDI-System-v2');
    this.stateModel.updateState(supabaseRestResult.component, supabaseRestResult.state, supabaseRestResult.evidence, supabaseRestResult.dependencies, supabaseRestResult.error);

    const ollamaResult = await this.checkOllama();
    this.stateModel.updateState(ollamaResult.component, ollamaResult.state, ollamaResult.evidence, ollamaResult.dependencies, ollamaResult.error);

    // Check boot.config.json modules
    for (const mod of this.bootConfig.modules) {
      if (mod.enabled === false) continue;
      const result = await this.checkModule(mod);
      this.stateModel.updateState(result.component, result.state, result.evidence, result.dependencies, result.error);
    }

    // Check bridge (api/chat/route.js) — functional probe
    const bridgeResult = await this.checkBridge();
    this.stateModel.updateState(bridgeResult.component, bridgeResult.state, bridgeResult.evidence, bridgeResult.dependencies, bridgeResult.error);

    return this.stateModel.getAllStates();
  }

  /**
   * Check a single boot.config.json module.
   */
  async checkModule(mod: BootConfigModule): Promise<HealthCheckResult> {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();

    if (mod.type === 'module') {
      // In-process module — state depends on parent process
      evidence.push({
        check: 'in-process',
        status: 'skip',
        value: 'in-process module',
        detail: `depends on ${mod.dependsOn?.join(', ') || 'parent'}`,
        checkedAt: now,
      });
      return {
        component: mod.id,
        state: 'UNKNOWN',
        evidence,
        dependencies: this.getDependencyStates(mod.dependsOn || []),
      };
    }

    if (!mod.port) {
      evidence.push({
        check: 'port',
        status: 'skip',
        value: 'no port configured',
        checkedAt: now,
      });
      return { component: mod.id, state: 'UNKNOWN', evidence };
    }

    // 1. Port check — is anything listening?
    const portStart = Date.now();
    const portOccupied = await this.canConnect(mod.port);
    evidence.push({
      check: 'port-listening',
      status: portOccupied ? 'pass' : 'fail',
      value: portOccupied ? `port ${mod.port} listening` : `port ${mod.port} not listening`,
      checkedAt: now,
      latencyMs: Date.now() - portStart,
    });

    if (!portOccupied) {
      return {
        component: mod.id,
        state: 'UNAVAILABLE',
        evidence,
        dependencies: this.getDependencyStates(mod.dependsOn || []),
        error: `port ${mod.port} not listening — process not running`,
      };
    }

    // 2. Process identity check — is the EXPECTED process on this port?
    //
    // A bare command match is not enough when the configured command is
    // itself generic (protoforge-core's configured command is literally
    // "node") — `cmdline.includes('node')` used to be an explicit OR
    // fallback here, which meant ANY node.exe process answering on the
    // port passed identity, including an unrelated orphan implementing the
    // same service. That is exactly how a supervised protoforge-core
    // instance (PID 4568) was invisibly replaced by an unrelated orphan
    // (PID 25324, a `node src/server.js` child of a since-exited Jest
    // process) that happens to answer the identical health check. Identity
    // is ancestry-aware (verifyProcessIdentity): the configured command AND
    // (when the module declares args) at least one configured arg must
    // appear in the occupant's own cmdline OR in an ancestor's — wrapped
    // launches like `npm run dev` bind the port several generations below
    // the wrapper, so the leaf alone can never contain the configured
    // command. Descent from the live boot-lease PID or the component's
    // recovery lease also proves identity; an unproven chain is UNKNOWN
    // (observer failure), never UNAVAILABLE.
    const pids = this.findPidsOnPort(mod.port);
    if (pids.length > 0) {
      const identity = this.verifyProcessIdentity(mod, pids);
      evidence.push({
        check: 'process-identity',
        status: identity.verdict === 'pass' ? 'pass' : identity.verdict === 'fail' ? 'fail' : 'warn',
        value: identity.value,
        detail: identity.detail,
        checkedAt: now,
      });

      if (identity.verdict === 'fail') {
        return {
          component: mod.id,
          state: 'UNAVAILABLE',
          evidence,
          dependencies: this.getDependencyStates(mod.dependsOn || []),
          error: `wrong process on port ${mod.port}: ${identity.detail}`,
        };
      }

      // Identity could not be established — this is an observer failure, not
      // a target failure. Reporting UNAVAILABLE here is what let a flaky
      // process probe (powershell/CIM timeout) feed governed recovery a
      // "confirmed" UNAVAILABLE verdict on a healthy service and restart it
      // (the phantom-restart loop observed 2026-09-18, where protoforge-core
      // burned its retry budget while fully healthy). UNKNOWN yields no
      // autonomous action in ActionSelector — the observation is visible,
      // and recovery is not authorized on unproven identity.
      if (identity.verdict === 'unknown') {
        return {
          component: mod.id,
          state: 'UNKNOWN',
          evidence,
          dependencies: this.getDependencyStates(mod.dependsOn || []),
          error: `process identity on port ${mod.port} could not be established (observer failure): ${identity.detail}`,
        };
      }
    } else {
      evidence.push({
        check: 'process-identity',
        status: 'warn',
        value: 'could not determine PID',
        checkedAt: now,
      });
    }

    // 3. Health endpoint check
    if (mod.health && mod.health.url) {
      const healthStart = Date.now();
      const { ok, statusCode, body } = await this.httpGet(mod.health.url);
      evidence.push({
        check: 'health-endpoint',
        status: ok ? 'pass' : 'fail',
        value: `HTTP ${statusCode}`,
        checkedAt: now,
        latencyMs: Date.now() - healthStart,
      });

      if (!ok) {
        return {
          component: mod.id,
          state: 'UNAVAILABLE',
          evidence,
          dependencies: this.getDependencyStates(mod.dependsOn || []),
          error: `health endpoint returned ${statusCode}: ${body.slice(0, 100)}`,
        };
      }

      // 4. Validate response body — not an error page
      const isErrorPage =
        body.includes('Cannot GET') ||
        body.includes('404 Not Found') ||
        body.includes('Internal Server Error');
      evidence.push({
        check: 'health-body',
        status: isErrorPage ? 'fail' : 'pass',
        value: isErrorPage ? 'error page detected' : 'valid response',
        detail: body.slice(0, 200),
        checkedAt: now,
      });

      if (isErrorPage) {
        return {
          component: mod.id,
          state: 'DEGRADED',
          evidence,
          dependencies: this.getDependencyStates(mod.dependsOn || []),
          error: 'health endpoint returned an error page',
        };
      }
    }

    // 5. Dependency check — are upstream dependencies healthy?
    const depStates = this.getDependencyStates(mod.dependsOn || []);
    const hasFailedDep = Object.values(depStates).some(
      (s) => s === 'UNAVAILABLE' || s === 'FAILED',
    );
    if (hasFailedDep) {
      const failedDeps = Object.entries(depStates)
        .filter(([, s]) => s === 'UNAVAILABLE' || s === 'FAILED')
        .map(([k]) => k);
      evidence.push({
        check: 'dependencies',
        status: 'fail',
        value: `failed deps: ${failedDeps.join(', ')}`,
        checkedAt: now,
      });
      return {
        component: mod.id,
        state: 'BLOCKED',
        evidence,
        dependencies: depStates,
        error: `blocked by failed dependencies: ${failedDeps.join(', ')}`,
      };
    }

    // All checks passed
    evidence.push({
      check: 'overall',
      status: 'pass',
      value: 'all checks passed',
      checkedAt: now,
    });

    return {
      component: mod.id,
      state: 'HEALTHY',
      evidence,
      dependencies: depStates,
    };
  }

  /**
   * Check database health — reachability + write/read/delete proof.
   */
  async checkDatabase(): Promise<HealthCheckResult> {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      evidence.push({
        check: 'env',
        status: 'fail',
        value: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set',
        checkedAt: now,
      });
      return { component: 'database', state: 'UNKNOWN', evidence, error: 'env vars not configured' };
    }

    // 1. REST API reachable
    const restStart = Date.now();
    const { ok: restOk, statusCode } = await this.httpGet(`${supabaseUrl}/rest/v1/`, 5000);
    evidence.push({
      check: 'rest-reachable',
      status: restOk ? 'pass' : 'fail',
      value: `HTTP ${statusCode}`,
      checkedAt: now,
      latencyMs: Date.now() - restStart,
    });

    if (!restOk) {
      return {
        component: 'database',
        state: 'UNAVAILABLE',
        evidence,
        error: `Supabase REST API unreachable at ${supabaseUrl}`,
      };
    }

    // 2. Service-role write/read test
    // All fetch calls use AbortSignal.timeout to prevent indefinite hangs when
    // Docker/Kong is in a degraded state (accepting connections but not responding).
    const FETCH_TIMEOUT_MS = 10000;
    try {
      const testId = `health_check_${Date.now()}`;
      const insertStart = Date.now();
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ id: testId, company: 'Health Check Probe', status: 'new' }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      evidence.push({
        check: 'service-role-write',
        status: insertRes.ok ? 'pass' : 'fail',
        value: `HTTP ${insertRes.status}`,
        checkedAt: now,
        latencyMs: Date.now() - insertStart,
      });

      if (!insertRes.ok) {
        return { component: 'database', state: 'DEGRADED', evidence, error: 'write failed' };
      }

      // Read back
      const readRes = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${testId}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const rows = await readRes.json();
      evidence.push({
        check: 'service-role-read',
        status: readRes.ok && rows.length === 1 ? 'pass' : 'fail',
        value: readRes.ok ? `${rows.length} row(s)` : `HTTP ${readRes.status}`,
        checkedAt: now,
      });

      // Delete
      await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${testId}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      evidence.push({
        check: 'service-role-delete',
        status: 'pass',
        value: 'cleanup done',
        checkedAt: now,
      });
    } catch (e) {
      evidence.push({
        check: 'service-role-write',
        status: 'fail',
        value: e instanceof Error ? e.message : 'unknown error',
        checkedAt: now,
      });
      return { component: 'database', state: 'DEGRADED', evidence, error: 'write/read failed' };
    }

    return { component: 'database', state: 'HEALTHY', evidence };
  }

  /**
   * Phase 6: Check a Supabase container (supabase_db or supabase_rest) as a
   * separate component. Uses docker inspect + REST probe as independent sources.
   * This is required for the governed recovery path — policies target
   * 'supabase_db' and 'supabase_rest' specifically.
   */
  async checkSupabaseContainer(componentId: string, containerName: string): Promise<HealthCheckResult> {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();

    // Source 1: Docker container state
    let dockerOk = false;
    let dockerStatus = 'unknown';
    try {
      const { getDockerCmd } = require('../../scripts/resolve-docker');
      const dockerCmd = getDockerCmd();
      // Docker-name charset + argv form — a caller-supplied containerName
      // interpolated into a shell string would be command injection.
      const nameOk = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,127}$/.test(containerName);
      if (dockerCmd && !nameOk) {
        evidence.push({
          check: 'docker-inspect',
          status: 'fail',
          value: `invalid container name refused`,
          checkedAt: now,
        });
      } else if (dockerCmd) {
        const { execFileSync } = require('child_process');
        const out = execFileSync(dockerCmd, ['inspect', '--format', '{{.State.Status}}', containerName], {
          encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true,
        });
        dockerStatus = out.trim();
        dockerOk = dockerStatus === 'running';
        evidence.push({
          check: 'docker-inspect',
          status: dockerOk ? 'pass' : 'fail',
          value: dockerStatus,
          checkedAt: now,
        });
      } else {
        evidence.push({
          check: 'docker-inspect',
          status: 'skip',
          value: 'docker not available',
          checkedAt: now,
        });
      }
    } catch (e) {
      dockerStatus = 'docker inspect failed';
      evidence.push({
        check: 'docker-inspect',
        status: 'fail',
        value: 'docker inspect failed',
        detail: e instanceof Error ? e.message : String(e),
        checkedAt: now,
      });
    }

    // Source 2: REST API probe (independent of docker inspect)
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let restOk = false;
    if (supabaseUrl) {
      const restStart = Date.now();
      const { ok, statusCode } = await this.httpGet(`${supabaseUrl}/rest/v1/`, 5000);
      restOk = ok;
      evidence.push({
        check: 'rest-reachable',
        status: ok ? 'pass' : 'fail',
        value: `HTTP ${statusCode}`,
        checkedAt: now,
        latencyMs: Date.now() - restStart,
      });
    } else {
      evidence.push({
        check: 'rest-reachable',
        status: 'skip',
        value: 'SUPABASE_URL not set',
        checkedAt: now,
      });
    }

    // Determine state: if both sources fail → UNAVAILABLE
    // If docker says stopped → UNAVAILABLE (target failure)
    // If docker fails but REST ok → HEALTHY (observer failure, target is fine)
    // If both ok → HEALTHY
    if (!dockerOk && !restOk) {
      return {
        component: componentId,
        state: 'UNAVAILABLE',
        evidence,
        error: `Container ${containerName} not running and REST API unreachable`,
      };
    }
    if (!dockerOk && restOk) {
      // Docker observer failed but service is healthy — target is fine
      return {
        component: componentId,
        state: 'HEALTHY',
        evidence,
      };
    }
    if (dockerOk && !restOk) {
      // Container running but REST API unreachable — degraded
      return {
        component: componentId,
        state: 'DEGRADED',
        evidence,
        error: `Container running but REST API unreachable`,
      };
    }

    return { component: componentId, state: 'HEALTHY', evidence };
  }

  /**
   * Check Ollama health — reachability + model availability.
   */
  async checkOllama(): Promise<HealthCheckResult> {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();
    const ollamaUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';

    const start = Date.now();
    const { ok, statusCode, body } = await this.httpGet(`${ollamaUrl}/api/tags`, 5000);
    evidence.push({
      check: 'ollama-reachable',
      status: ok ? 'pass' : 'fail',
      value: `HTTP ${statusCode}`,
      checkedAt: now,
      latencyMs: Date.now() - start,
    });

    if (!ok) {
      return {
        component: 'ollama',
        state: 'UNAVAILABLE',
        evidence,
        error: `Ollama unreachable at ${ollamaUrl}`,
      };
    }

    // Parse models
    try {
      const fullRes = await fetch(`${ollamaUrl}/api/tags`);
      const data = await fullRes.json();
      const modelCount = (data.models || []).length;
      evidence.push({
        check: 'ollama-models',
        status: modelCount > 0 ? 'pass' : 'warn',
        value: `${modelCount} model(s)`,
        checkedAt: now,
      });
    } catch {
      evidence.push({
        check: 'ollama-models',
        status: 'warn',
        value: 'could not parse response',
        checkedAt: now,
      });
    }

    return { component: 'ollama', state: 'HEALTHY', evidence };
  }

  /**
   * Check bridge — the universal chat router. This is a functional probe,
   * not just an HTTP check. It verifies that the chat route is reachable
   * through heidi-web.
   */
  async checkBridge(): Promise<HealthCheckResult> {
    const evidence: HealthEvidence[] = [];
    const now = new Date().toISOString();

    // The bridge is served through heidi-web's /api/chat endpoint.
    // We do a lightweight OPTIONS/GET to verify the route exists.
    const bridgeUrl = 'http://127.0.0.1:3000/api/chat';
    const start = Date.now();
    const { ok, statusCode } = await this.httpGet(bridgeUrl, 5000);
    evidence.push({
      check: 'bridge-endpoint',
      status: statusCode > 0 && statusCode < 500 ? 'pass' : 'fail',
      value: `HTTP ${statusCode}`,
      detail: 'bridge is reachable via heidi-web /api/chat',
      checkedAt: now,
      latencyMs: Date.now() - start,
    });

    // A 404 or 405 means the route doesn't exist — bridge is broken
    if (statusCode === 404 || statusCode === 0) {
      return {
        component: 'bridge',
        state: 'UNAVAILABLE',
        evidence,
        error: 'bridge route not found',
      };
    }

    // Check dependency states
    const depStates = this.getDependencyStates(['protoforge-core', 'heidi-web']);
    const hasFailedDep = Object.values(depStates).some(
      (s) => s === 'UNAVAILABLE' || s === 'FAILED',
    );

    if (hasFailedDep) {
      return {
        component: 'bridge',
        state: 'BLOCKED',
        evidence,
        dependencies: depStates,
        error: 'bridge blocked by failed dependencies',
      };
    }

    return { component: 'bridge', state: 'HEALTHY', evidence, dependencies: depStates };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getDependencyStates(deps: string[]): Record<string, ComponentState> {
    const states: Record<string, ComponentState> = {};
    for (const dep of deps) {
      states[dep] = this.stateModel.getState(dep).state;
    }
    return states;
  }

  private canConnect(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => resolve(false));
      socket.connect(port, host);
    });
  }

  private httpGet(url: string, timeoutMs = 5000): Promise<{ ok: boolean; statusCode: number; body: string }> {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500,
            statusCode: res.statusCode || 0,
            body: body.slice(0, 500),
          });
        });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0, body: 'timeout' }); });
      req.on('error', (e) => resolve({ ok: false, statusCode: 0, body: e.message }));
    });
  }

  private findPidsOnPort(port: number): string[] {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
    try {
      if (process.platform === 'win32') {
        const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
        const pids = new Set<string>();
        for (const line of out.split('\n')) {
          if (!line.includes(`:${port}`)) continue;
          if (!/LISTENING/i.test(line)) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) pids.add(pid);
        }
        return [...pids];
      }
      const out = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
      return out.trim().split('\n').filter(Boolean);
    } catch { return []; }
  }

  private getProcessInfo(pid: string): { name: string; cmdline: string } {
    // pid is interpolated into shell commands below — it must be digits only.
    if (!/^\d+$/.test(pid)) return { name: 'unknown', cmdline: 'unknown' };
    try {
      if (process.platform === 'win32') {
        const out = execSync(
          `powershell -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object ProcessName | Format-List"`,
          { encoding: 'utf8', timeout: 5000 },
        );
        const nameMatch = out.match(/ProcessName\s*:\s*(.+)/);
        const name = nameMatch ? nameMatch[1].trim() : 'unknown';
        let cmdline = '';
        try {
          cmdline = execSync(
            `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
            { encoding: 'utf8', timeout: 5000 },
          ).trim();
        } catch { cmdline = name; }
        return { name, cmdline: cmdline || name };
      } else {
        const out = execSync(`ps -p ${pid} -o comm= args=`, { encoding: 'utf8', timeout: 5000 });
        return { name: out.trim(), cmdline: out.trim() };
      }
    } catch { /* ignore */ }
    return { name: 'unknown', cmdline: 'unknown' };
  }

  /**
   * The whole process table in ONE probe: pid → {name, cmdline, ppid}.
   *
   * Per-node probing (3 powershell spawns per ancestor — name, cmdline,
   * ppid) is the measured flake source: under load, CIM CommandLine queries
   * intermittently exceed their timeout, truncating ancestry walks and
   * producing UNKNOWN verdicts on fully-canonical chains. One bulk query is
   * a single spawn, a consistent snapshot, and typically ~2–4s total.
   *
   * Returns null when the table itself cannot be loaded — callers then fall
   * back to per-node probing. Cached for CACHE_MS so a checkAll sweep over
   * several modules costs one spawn total, not one per module.
   */
  private procTableCache: { at: number; map: Map<string, { name: string; cmdline: string; ppid: string | null }> } | null = null;
  private static readonly PROC_TABLE_CACHE_MS = 15000;

  private getProcessTable(): Map<string, { name: string; cmdline: string; ppid: string | null }> | null {
    const now = Date.now();
    if (this.procTableCache && now - this.procTableCache.at < HealthProvenanceChecker.PROC_TABLE_CACHE_MS) {
      return this.procTableCache.map;
    }
    try {
      let map: Map<string, { name: string; cmdline: string; ppid: string | null }> | null = null;
      if (process.platform === 'win32') {
        const out = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object -Property ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"',
          { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
        ).trim();
        const rows = out ? JSON.parse(out) : [];
        const list = Array.isArray(rows) ? rows : [rows];
        map = new Map();
        for (const r of list) {
          if (!r || r.ProcessId == null) continue;
          map.set(String(r.ProcessId), {
            name: String(r.Name || 'unknown'),
            cmdline: String(r.CommandLine || r.Name || ''),
            ppid: r.ParentProcessId != null ? String(r.ParentProcessId) : null,
          });
        }
      } else {
        const out = execSync('ps -eo pid=,ppid=,comm=,args=', { encoding: 'utf8', timeout: 15000 });
        map = new Map();
        for (const line of out.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          const m = t.match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
          if (!m) continue;
          map.set(m[1], { name: m[3], cmdline: m[4] || m[3], ppid: m[2] });
        }
      }
      this.procTableCache = { at: now, map };
      return map;
    } catch {
      return null;
    }
  }

  /**
   * Parent PID of a process — tri-state by design:
   *   - the ppid string when resolved
   *   - null when the process has no parent record (dead process or chain end)
   *   - 'error' when the probe itself failed (timeout etc.)
   *
   * The distinction is load-bearing: a timed-out parent lookup must be an
   * observer failure, never "no parent". Measured 2026-09-19: under load,
   * powershell CIM queries intermittently exceed a 5s timeout, and a failed
   * parent probe looked identical to a clean chain end — truncating the
   * ancestry walk and scoring a canonical service `wrong process` on a live
   * port (observed on heidi-web pid 31696, real parent 25588).
   */
  private getParentPid(pid: string): string | null | 'error' {
    if (!/^\d+$/.test(pid)) return 'error';
    try {
      if (process.platform === 'win32') {
        const out = execSync(
          `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId"`,
          { encoding: 'utf8', timeout: 8000 },
        ).trim();
        return /^\d+$/.test(out) ? out : null;
      }
      const out = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf8', timeout: 8000 }).trim();
      return /^\d+$/.test(out) ? out : null;
    } catch { return 'error'; }
  }

  /**
   * PID of the live canonical boot authority, from its lease file, or null.
   * An occupant whose ancestry reaches this PID is a canonical boot child —
   * the strongest ownership evidence available, stronger than any cmdline
   * string match.
   */
  private getBootLeasePid(): string | null {
    try {
      const leasePath = process.env.HYDI_BOOT_LEASE_PATH
        ? path.resolve(process.env.HYDI_BOOT_LEASE_PATH)
        : path.resolve(this.root, '.hydi-boot.lock');
      const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
      return lease && Number.isInteger(lease.pid) ? String(lease.pid) : null;
    } catch { return null; }
  }

  /**
   * PID recorded by the component's recovery lease (the spawn wrapper
   * RecoveryEngine or boot-agent recorded), or null. Mirrors
   * boot-agent.js's classifyOccupant 'recovered' case.
   */
  private getRecoveryLeasePid(component: string): string | null {
    try {
      const { getValidLease } = require('../../scripts/recovery-lease');
      const lease = getValidLease(component);
      return lease && Number.isInteger(lease.pid) ? String(lease.pid) : null;
    } catch { return null; }
  }

  /**
   * Ancestry-aware process identity.
   *
   * The pre-ancestry implementation inspected only the port-owning PID's
   * command line and required it to literally contain the configured command
   * (`mod.command` + `mod.args`). That is unprovable for wrapped launches —
   * heidi-web's configured `npm run dev` spawns `cmd → npm → next dev →
   * next start-server`, so the process actually bound to the port never
   * contains 'npm run dev'. The result was a deterministic `wrong process`
   * on a healthy, canonical service — which governed recovery then treated
   * as UNAVAILABLE and restarted (measured 2026-09-18: heidi-web's retry
   * budget exhausted 3/3 on a live, listening service).
   *
   * Identity is now established by walking the occupant's ancestor chain
   * (bounded depth 8) and is satisfied by ANY of:
   *   1. leaf cmdline matches configured command + args (direct owner);
   *   2. an ancestor's cmdline matches the configured command family
   *      (the `npm run dev` / `cmd /c next dev` wrappers);
   *   3. the chain reaches the live boot-authority lease PID — the occupant
   *      provably descends from the canonical supervisor;
   *   4. the chain reaches the component's recovery-lease PID — an
   *      intentionally recovered replacement (see scripts/recovery-lease.js).
   *
   * Verdicts:
   *   'pass'    — identity established by one of the four proofs above;
   *   'fail'    — full ancestry resolved and nothing matched (genuinely
   *               wrong process answering on the port);
   *   'unknown' — process info or ancestry could not be fully read
   *               (observer failure — NOT a target failure; callers must
   *               not treat this as UNAVAILABLE).
   */
  private verifyProcessIdentity(
    mod: BootConfigModule,
    pids: string[],
  ): { verdict: 'pass' | 'fail' | 'unknown'; value: string; detail: string } {
    const expectedCmd = (mod.command || 'node').toLowerCase();
    const expectedArgs = (mod.args || []).map((a) => String(a).toLowerCase());
    const matchesExpected = (cmdline: string): boolean => {
      const c = (cmdline || '').toLowerCase();
      return c.includes(expectedCmd) &&
        (expectedArgs.length === 0 || expectedArgs.some((a) => a && c.includes(a)));
    };

    // Walk the ancestor chain, bounded. Preferred source is a single
    // snapshot of the whole process table (getProcessTable); per-node
    // probing is only the fallback when the table itself is unloadable.
    // In table mode a node absent from the snapshot is a dead process —
    // a clean chain end, not a probe failure.
    const table = this.getProcessTable();
    const chain: { pid: string; name: string; cmdline: string }[] = [];
    const seen = new Set<string>();
    let unresolved = false;
    let current: string | null = pids[0];
    for (let depth = 0; current && depth < 8; depth++) {
      if (seen.has(current)) break;
      seen.add(current);
      if (table) {
        const rec = table.get(current);
        if (!rec) break; // not in the snapshot → exited before/during load — clean end
        chain.push({ pid: current, name: rec.name, cmdline: rec.cmdline });
        const parent = rec.ppid;
        if (!parent || parent === current || parent === '0') break;
        current = parent;
      } else {
        const info = this.getProcessInfo(current);
        const readable = Boolean(info && info.cmdline && info.cmdline !== 'unknown');
        chain.push({ pid: current, name: info?.name || 'unknown', cmdline: readable ? info.cmdline : '' });
        if (!readable) { unresolved = true; break; }
        const parent = this.getParentPid(current);
        // 'error' = the probe failed — the chain is truncated by
        // observation, not exhausted. Only a resolved parent (or its genuine
        // absence: null) may end the walk cleanly.
        if (parent === 'error') { unresolved = true; break; }
        if (!parent || parent === current || parent === '0') break;
        current = parent;
      }
    }

    // The port owner itself could not be read at all — it exists (netstat
    // bound it) but no observation of it succeeded. That is unresolvable
    // observer failure, full stop.
    if (chain.length === 0) {
      return {
        verdict: 'unknown',
        value: `port owner PID ${pids[0]} unreadable`,
        detail: `expected: ${expectedCmd}${mod.args ? ' ' + mod.args.join(' ') : ''}; port owner absent from process observation`,
      };
    }

    const leaf = chain[0];
    const describe = (n: { pid: string; name: string; cmdline: string }) =>
      `${n.name || 'unknown'} (PID ${n.pid})`;

    // Proof 1 & 2: configured command family appears in leaf or an ancestor.
    const matched = chain.find((n) => n.cmdline && matchesExpected(n.cmdline));
    if (matched) {
      const via = matched === leaf ? 'direct' : `ancestor ${describe(matched)}`;
      return {
        verdict: 'pass',
        value: `PID ${leaf.pid} (${leaf.name}) — expected command found in ${via}`,
        detail: `expected: ${expectedCmd}${mod.args ? ' ' + mod.args.join(' ') : ''}, chain: ${chain.map((n) => `${n.pid}:${n.name}`).join(' <- ')}`,
      };
    }

    // Proof 3: ancestry reaches the canonical boot authority.
    const bootPid = this.getBootLeasePid();
    if (bootPid && chain.some((n) => n.pid === bootPid)) {
      return {
        verdict: 'pass',
        value: `PID ${leaf.pid} (${leaf.name}) — descendant of canonical boot-agent (PID ${bootPid})`,
        detail: `boot-lease ancestry proof; chain: ${chain.map((n) => `${n.pid}:${n.name}`).join(' <- ')}`,
      };
    }

    // Proof 4: ancestry reaches the recovery-lease spawn (intentional recovery).
    const leasePid = this.getRecoveryLeasePid(mod.id);
    if (leasePid && chain.some((n) => n.pid === leasePid)) {
      return {
        verdict: 'pass',
        value: `PID ${leaf.pid} (${leaf.name}) — descendant of recorded recovery spawn (PID ${leasePid})`,
        detail: `recovery-lease ancestry proof; chain: ${chain.map((n) => `${n.pid}:${n.name}`).join(' <- ')}`,
      };
    }

    if (unresolved) {
      return {
        verdict: 'unknown',
        value: `identity unproven: ${describe(leaf)}`,
        detail: `expected: ${expectedCmd}${mod.args ? ' ' + mod.args.join(' ') : ''}; ancestor chain truncated by unreadable process info (${chain.map((n) => `${n.pid}:${n.name}`).join(' <- ')})`,
      };
    }

    const dupNote = pids.length > 1 ? ` (multiple pids on port: ${pids.join(', ')})` : '';
    return {
      verdict: 'fail',
      value: `wrong process: ${describe(leaf)}`,
      detail: `expected: ${expectedCmd}${mod.args ? ' ' + mod.args.join(' ') : ''}; no match in resolved chain ${chain.map((n) => `${n.pid}:${n.name}`).join(' <- ')}${dupNote}`,
    };
  }
}
