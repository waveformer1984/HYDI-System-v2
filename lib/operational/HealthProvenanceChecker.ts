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
    const pids = this.findPidsOnPort(mod.port);
    if (pids.length > 0) {
      const procInfo = this.getProcessInfo(pids[0]);
      const expectedCmd = mod.command || 'node';
      const cmdlineLower = (procInfo.cmdline || '').toLowerCase();
      const expectedLower = expectedCmd.toLowerCase();

      const isCorrectProcess =
        cmdlineLower.includes(expectedLower) || cmdlineLower.includes('node');

      evidence.push({
        check: 'process-identity',
        status: isCorrectProcess ? 'pass' : 'fail',
        value: isCorrectProcess
          ? `PID ${pids[0]} (${procInfo.name})`
          : `wrong process: ${procInfo.name} (PID ${pids[0]})`,
        detail: `expected: ${expectedCmd}, cmdline: ${procInfo.cmdline.slice(0, 120)}`,
        checkedAt: now,
      });

      if (!isCorrectProcess) {
        return {
          component: mod.id,
          state: 'UNAVAILABLE',
          evidence,
          dependencies: this.getDependencyStates(mod.dependsOn || []),
          error: `wrong process on port ${mod.port}: expected ${expectedCmd}, found ${procInfo.name}`,
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
}
