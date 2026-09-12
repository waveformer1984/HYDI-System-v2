/**
 * Regression tests for the process-identity loophole fix in
 * HealthProvenanceChecker.checkModule().
 *
 * Before this fix, identity was:
 *
 *   cmdline.includes(expectedCommand) || cmdline.includes('node')
 *
 * The `|| cmdline.includes('node')` fallback meant that for any module whose
 * configured command is itself "node" (protoforge-core, heidi-mobile-chat,
 * job-executor-poller's underlying runtime, ...), literally ANY node.exe
 * process answering on the configured port satisfied identity — including
 * an unrelated orphan implementing the same service. Identity now requires
 * the configured command AND (when the module declares args) at least one
 * configured arg — the actual script/module path.
 *
 * `canConnect`, `httpGet`, `findPidsOnPort` and `getProcessInfo` are
 * TypeScript-private instance methods; they are overridden directly on the
 * constructed instance here rather than via `child_process`/`net`/`http`
 * module mocks, so these tests never touch a real port, process, or
 * network call.
 */

import path from 'path';
import { HealthProvenanceChecker } from '../../lib/operational/HealthProvenanceChecker';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import type { DependencyGraph } from '../../lib/operational/types';

const PROTOFORGE_CORE = {
  id: 'protoforge-core',
  type: 'process' as const,
  required: true,
  command: 'node',
  args: ['src/server.js'],
  port: 3005,
  health: { url: 'http://127.0.0.1:3005/health' },
  dependsOn: [],
};

function buildChecker() {
  const root = path.resolve(__dirname, '..', '..');
  const model = new SystemStateModel();
  // checkModule() never reads `graph` directly (only getDependencyStates(),
  // which is a no-op for dependsOn: []), so an empty graph is sufficient —
  // no real DependencyGraphBuilder pass over the repo is needed here.
  const emptyGraph = { nodes: new Map() } as unknown as DependencyGraph;
  const checker = new HealthProvenanceChecker(root, model, emptyGraph);
  return checker as any; // access to TS-private test seams below is intentional
}

describe('HealthProvenanceChecker.checkModule: process-identity loophole', () => {
  it('Test A: correct command + correct script + healthy => HEALTHY', async () => {
    const checker = buildChecker();
    checker.canConnect = jest.fn().mockResolvedValue(true);
    checker.findPidsOnPort = jest.fn().mockReturnValue(['27608']);
    checker.getProcessInfo = jest.fn().mockReturnValue({ name: 'node.exe', cmdline: 'node src/server.js' });
    checker.httpGet = jest.fn().mockResolvedValue({ ok: true, statusCode: 200, body: '{"status":"ok"}' });

    const result = await checker.checkModule(PROTOFORGE_CORE);

    expect(result.state).toBe('HEALTHY');
    const identityEvidence = result.evidence.find((e: any) => e.check === 'process-identity');
    expect(identityEvidence.status).toBe('pass');
  });

  it('Test B: healthy unrelated node process (closed loophole) => UNAVAILABLE, not HEALTHY', async () => {
    const checker = buildChecker();
    checker.canConnect = jest.fn().mockResolvedValue(true);
    checker.findPidsOnPort = jest.fn().mockReturnValue(['9999']);
    // cmdline contains "node" (the configured command) but not the
    // configured script — exactly what `|| cmdline.includes('node')` used
    // to accept.
    checker.getProcessInfo = jest.fn().mockReturnValue({ name: 'node.exe', cmdline: 'node scripts/some-unrelated-tool.js' });
    checker.httpGet = jest.fn().mockResolvedValue({ ok: true, statusCode: 200, body: '{"status":"ok"}' });

    const result = await checker.checkModule(PROTOFORGE_CORE);

    expect(result.state).toBe('UNAVAILABLE');
    expect(result.error).toMatch(/wrong process on port 3005/);
    // The HTTP health endpoint is never even consulted once identity fails
    // — a wrong process answering "healthy" must not reach that check.
    expect(checker.httpGet).not.toHaveBeenCalled();
  });

  it('a bare "node --version"-style match is rejected (the literal old fallback case)', async () => {
    const checker = buildChecker();
    checker.canConnect = jest.fn().mockResolvedValue(true);
    checker.findPidsOnPort = jest.fn().mockReturnValue(['1']);
    checker.getProcessInfo = jest.fn().mockReturnValue({ name: 'node.exe', cmdline: 'node --version' });

    const result = await checker.checkModule(PROTOFORGE_CORE);
    expect(result.state).toBe('UNAVAILABLE');
  });

  it('no PID attributable to the port => warns, does not fabricate a pass', async () => {
    const checker = buildChecker();
    checker.canConnect = jest.fn().mockResolvedValue(true);
    checker.findPidsOnPort = jest.fn().mockReturnValue([]);
    checker.httpGet = jest.fn().mockResolvedValue({ ok: true, statusCode: 200, body: '{"status":"ok"}' });

    const result = await checker.checkModule(PROTOFORGE_CORE);

    const identityEvidence = result.evidence.find((e: any) => e.check === 'process-identity');
    expect(identityEvidence.status).toBe('warn');
    // Absence of a PID is not treated as a wrong-process rejection...
    expect(result.state).not.toBe('UNAVAILABLE');
    // ...but it also doesn't block on the (mocked) health endpoint check —
    // this asserts the existing "warn and continue to the health check"
    // behavior is unchanged by the identity fix.
    expect(checker.httpGet).toHaveBeenCalled();
  });

  it('a module with no configured args is identified by command alone', async () => {
    const checker = buildChecker();
    const legacyModule = {
      id: 'legacy-tool', type: 'process' as const, required: false,
      command: 'python', port: 8080,
      health: { url: 'http://127.0.0.1:8080/health' }, dependsOn: [],
    };
    checker.canConnect = jest.fn().mockResolvedValue(true);
    checker.findPidsOnPort = jest.fn().mockReturnValue(['555']);
    checker.getProcessInfo = jest.fn().mockReturnValue({ name: 'python.exe', cmdline: 'python -m http.server 8080' });
    checker.httpGet = jest.fn().mockResolvedValue({ ok: true, statusCode: 200, body: '{"status":"ok"}' });

    const result = await checker.checkModule(legacyModule);
    expect(result.state).toBe('HEALTHY');
  });
});
