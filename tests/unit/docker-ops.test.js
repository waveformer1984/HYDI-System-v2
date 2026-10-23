'use strict';

/**
 * Docker ops port — salvage of src/heidi-executive's container observation
 * + bounded restart into the governed human-action plane.
 *
 * Proves: read-only collection is honest about environment, detection
 * mints dedupe-keyed per-container actions, classification is R1 with the
 * declared resolver, the restart resolver is allowlist-bound + read-back
 * verified, and the verifier independently inspects live state.
 * Every docker call is injected — no docker daemon is touched in tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { HumanActionService } = require('../../lib/human-actions/service');
const { detectDockerContainers, syncHumanActions } = require('../../lib/human-actions/detector');
const { classifyAction, isAgentResolvable } = require('../../lib/human-actions/resolver-policy');
const { getResolver } = require('../../lib/human-actions/resolvers');
const { runVerifier } = require('../../lib/human-actions/verifiers');
const { collectDockerContainers, inspectDockerContainer } = require('../../lib/runtime/docker');

let dir;
let storeFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-ops-'));
  storeFile = path.join(dir, 'human-actions.json');
  process.env.HYDI_HUMAN_ACTIONS_FILE = storeFile;
});

afterEach(() => {
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
});

const mkEnv = (vals = {}) => ({
  envNamePresent: (n) => vals[n] !== undefined && vals[n] !== '',
  envValue: (n) => vals[n] ?? null,
});

/** Stub exec seam — argv-shape assertions prove no shell is involved. */
function stubExec(handlers, calls = []) {
  return async (cmd, args) => {
    calls.push([cmd, ...args]);
    for (const [match, fn] of handlers) {
      if (args.join(' ').includes(match)) return fn();
    }
    return { ok: false, stdout: '', stderr: '', error: 'unhandled argv in stub' };
  };
}

describe('collectDockerContainers', () => {
  test('reports NOT_CONFIGURED when the docker CLI is absent', async () => {
    const res = await collectDockerContainers({
      exec: async () => ({ ok: false, stdout: '', stderr: '', error: 'spawn docker ENOENT' }),
    });
    expect(res.docker).toBe('NOT_CONFIGURED');
    expect(res.containers).toEqual([]);
  });

  test('reports UNAVAILABLE when the daemon is unreachable', async () => {
    const res = await collectDockerContainers({
      exec: async () => ({ ok: false, stdout: '', stderr: 'Cannot connect to the Docker daemon', error: 'exit 1' }),
    });
    expect(res.docker).toBe('UNAVAILABLE');
  });

  test('parses container states and fetches restart counts for unhealthy rows', async () => {
    const calls = [];
    const exec = stubExec([
      ['version', () => ({ ok: true, stdout: '24.0.5', stderr: '', error: null })],
      ['ps', () => ({ ok: true, stdout: 'supabase_db_X\tUp 3 hours (healthy)\nsupabase_inbucket_X\tExited (1) 2 minutes ago', stderr: '', error: null })],
      ['inspect', () => ({ ok: true, stdout: 'exited\t4', stderr: '', error: null })],
    ], calls);
    const res = await collectDockerContainers({ exec });
    expect(res.docker).toBe('DEGRADED');
    const dead = res.containers.find((c) => c.name === 'supabase_inbucket_X');
    expect(dead.exited).toBe(true);
    expect(dead.restartCount).toBe(4);
    // inspect only ran for the non-running row
    expect(calls.filter((c) => c.includes('inspect')).length).toBe(1);
    expect(calls.filter((c) => c.includes('inspect'))[0]).toContain('supabase_inbucket_X');
  });
});

describe('detectDockerContainers', () => {
  test('mints one dedupe-keyed action per crashed container', async () => {
    const svc = new HumanActionService();
    const collect = async () => ({
      docker: 'DEGRADED',
      containers: [
        { name: 'supabase_inbucket_X', status: 'Exited (1) 2m ago', running: false, exited: true, restarting: false, restartCount: 4 },
        { name: 'supabase_db_X', status: 'Up 3h (healthy)', running: true, exited: false, restarting: false },
      ],
    });
    const first = await detectDockerContainers(svc, mkEnv(), { collect });
    expect(first.minted.length).toBe(1);
    expect(first.minted[0].created).toBe(true);
    const action = svc.get(first.minted[0].actionId);
    expect(action.blockerKey).toBe('docker:container-supabase_inbucket_X');
    expect(action.verifier.name).toBe('docker-container-running');
    expect(action.verifier.spec.container).toBe('supabase_inbucket_X');
    // Second pass dedupes — no duplicate action
    const second = await detectDockerContainers(svc, mkEnv(), { collect });
    expect(second.minted[0].created).toBe(false);
    expect(second.minted[0].actionId).toBe(first.minted[0].actionId);
  });

  test('mints nothing for healthy or absent docker', async () => {
    const svc = new HumanActionService();
    const healthy = await detectDockerContainers(svc, mkEnv(), {
      collect: async () => ({ docker: 'HEALTHY', containers: [{ name: 'x', running: true, exited: false, restarting: false }] }),
    });
    expect(healthy.minted).toEqual([]);
    const absent = await detectDockerContainers(svc, mkEnv(), {
      collect: async () => ({ docker: 'NOT_CONFIGURED', containers: [] }),
    });
    expect(absent.minted).toEqual([]);
    expect(svc.listOpen().length).toBe(0);
  });
});

describe('docker policy + resolver', () => {
  test('per-container blockerKey classifies R1 via the prefix contract', () => {
    const c = classifyAction({ blockerKey: 'docker:container-supabase_db_X', boundary: { category: 'INFRASTRUCTURE' } });
    expect(c.resolutionClass).toBe('R1');
    expect(c.resolverId).toBe('docker-restart');
    expect(isAgentResolvable(c.resolutionClass)).toBe(true);
    // unknown INFRASTRUCTURE boundaries still fall back to R2 — fail closed
    const c2 = classifyAction({ blockerKey: 'something:else', boundary: { category: 'INFRASTRUCTURE' } });
    expect(c2.resolutionClass).toBe('R2');
  });

  test('resolver refuses a non-allowlisted container', async () => {
    const svc = new HumanActionService();
    const { action } = svc.request({
      blockerKey: 'docker:container-evil', type: 'infrastructure',
      boundary: { category: 'INFRASTRUCTURE' }, title: 't', description: 'd',
      instructions: ['x'], verifier: { name: 'docker-container-running', spec: { container: 'evil' } },
      context: { container: 'evil' },
    });
    const resolver = getResolver('docker-restart');
    const result = await resolver({
      action: svc.get(action.id),
      policy: classifyAction(svc.get(action.id)),
      env: mkEnv({ HYDI_DOCKER_RESTART_ALLOW: 'supabase_db_X' }),
      deps: {},
    });
    expect(result.outcome).toBe('unauthorized');
    expect(result.reason).toContain('HYDI_DOCKER_RESTART_ALLOW');
  });

  test('resolver restarts an allowlisted crashed container and reads back state', async () => {
    const svc = new HumanActionService();
    const { action } = svc.request({
      blockerKey: 'docker:container-supabase_db_X', type: 'infrastructure',
      boundary: { category: 'INFRASTRUCTURE' }, title: 't', description: 'd',
      instructions: ['x'], verifier: { name: 'docker-container-running', spec: { container: 'supabase_db_X' } },
      context: { container: 'supabase_db_X' },
    });
    let restarted = false;
    const dockerExec = {
      inspectDockerContainer: async () => restarted
        ? { exists: true, running: true, restarting: false, restartCount: 5, error: null }
        : { exists: true, running: false, restarting: false, restartCount: 4, error: null },
    };
    const resolver = getResolver('docker-restart');
    const result = await resolver({
      action: svc.get(action.id),
      policy: classifyAction(svc.get(action.id)),
      env: mkEnv({ HYDI_DOCKER_RESTART_ALLOW: 'supabase_db_X' }),
      deps: { dockerExec, dockerRestart: async () => { restarted = true; return { ok: true }; } },
    });
    expect(result.outcome).toBe('completed');
    expect(result.evidence.restartCount).toBe(5);
  });

  test('resolver short-circuits when the container already runs (idempotent)', async () => {
    const svc = new HumanActionService();
    const { action } = svc.request({
      blockerKey: 'docker:container-up', type: 'infrastructure',
      boundary: { category: 'INFRASTRUCTURE' }, title: 't', description: 'd',
      instructions: ['x'], verifier: { name: 'docker-container-running', spec: { container: 'up' } },
      context: { container: 'up' },
    });
    let restartCalled = false;
    const resolver = getResolver('docker-restart');
    const result = await resolver({
      action: svc.get(action.id),
      policy: classifyAction(svc.get(action.id)),
      env: mkEnv({ HYDI_DOCKER_RESTART_ALLOW: 'up' }),
      deps: {
        dockerExec: { inspectDockerContainer: async () => ({ exists: true, running: true, restarting: false, restartCount: 0 }) },
        dockerRestart: async () => { restartCalled = true; return { ok: true }; },
      },
    });
    expect(result.outcome).toBe('completed');
    expect(restartCalled).toBe(false);
  });
});

describe('docker-container-running verifier', () => {
  test('independently inspects live state — running verifies, exited fails', async () => {
    const svc = new HumanActionService();
    const { action } = svc.request({
      blockerKey: 'docker:container-verify', type: 'infrastructure',
      boundary: { category: 'INFRASTRUCTURE' }, title: 't', description: 'd',
      instructions: ['x'], verifier: { name: 'docker-container-running', spec: { container: 'c1' } },
      context: { container: 'c1' },
    });
    const exited = await runVerifier('docker-container-running', { container: 'c1' }, {
      docker: { inspectDockerContainer: async () => ({ exists: true, running: false, restarting: false, restartCount: 2 }) },
    });
    expect(exited.status).toBe('FAILED');
    const running = await runVerifier('docker-container-running', { container: 'c1' }, {
      docker: { inspectDockerContainer: async () => ({ exists: true, running: true, restarting: false, restartCount: 3 }) },
    });
    expect(running.status).toBe('VERIFIED');
    expect(running.evidence.container).toBe('c1');
    expect(action.id).toBeDefined();
  });
});

describe('syncHumanActions wiring', () => {
  test('the docker pass runs inside the sync cadence', async () => {
    const svc = new HumanActionService();
    const out = await syncHumanActions(svc, null, {
      env: mkEnv(),
      dockerCheck: {
        collect: async () => ({
          docker: 'DEGRADED',
          containers: [{ name: 'crashed1', status: 'Exited', running: false, exited: true, restarting: false, restartCount: 1 }],
        }),
      },
      resolve: { disabled: true },
      verify: { disabled: true },
      staleCheck: { fetch: async () => { throw new Error('no net'); }, confirmAttempts: 1 },
    });
    expect(out.docker.checked).toBe(true);
    expect(out.docker.minted.length).toBe(1);
    const actions = svc.listOpen().filter((a) => a.blockerKey === 'docker:container-crashed1');
    expect(actions.length).toBe(1);
  });
});
