/**
 * Regression tests for ancestry-aware process identity in
 * HealthProvenanceChecker.checkModule().
 *
 * Live-state re-establishment (2026-09-18) found two defects sharing one
 * boundary:
 *
 * 1. heidi-web was classified UNAVAILABLE deterministically — its
 *    configured command is `npm run dev` but the process bound to :3000 is
 *    the grandchild `next start-server`, whose cmdline contains neither
 *    'npm' nor 'run dev'. Every governed recovery evaluation restarted or
 *    escalated a healthy service (budget exhausted 3/3).
 *
 * 2. The same leaf-only check fed the "phantom restarter": a flaky
 *    powershell/CIM probe returned `unknown`, which scored as
 *    `wrong process` → UNAVAILABLE → a HEALTHY protoforge-core was
 *    restarted repeatedly until its budget tripped (4/3).
 *
 * Identity now walks the port owner's ancestor chain — preferably over a
 * single snapshot of the whole process table (one probe, consistent
 * ancestry), falling back to per-node probing only when the table itself
 * cannot be loaded. A configured command-family match in the leaf OR any
 * ancestor, descent from the live boot-lease pid, or descent from the
 * component's recovery lease all prove identity. A fully-resolved chain
 * with no match is `wrong process` (dead ancestors are resolved ends).
 * A probe FAILURE — unreadable leaf, errored lookup — is an observer
 * failure → UNKNOWN, never UNAVAILABLE.
 */

import path from 'path';
import { HealthProvenanceChecker } from '../../lib/operational/HealthProvenanceChecker';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import type { DependencyGraph } from '../../lib/operational/types';

const HEIDI_WEB = {
  id: 'heidi-web',
  type: 'process' as const,
  required: true,
  command: 'npm',
  args: ['run', 'dev'],
  port: 3000,
  health: { url: 'http://127.0.0.1:3000/api/health' },
  dependsOn: ['protoforge-core'],
};

const PROTOFORGE = {
  id: 'protoforge-core',
  type: 'process' as const,
  required: true,
  command: 'node',
  args: ['src/server.js'],
  port: 3005,
  health: { url: 'http://127.0.0.1:3005/health' },
  dependsOn: [],
};

type ProcMap = Record<string, { name: string; cmdline: string } | 'unreadable'>;

function buildChecker(opts: {
  processes: ProcMap;
  parents: Record<string, string | null>;
  bootLeasePid?: string | null;
  recoveryLeasePid?: string | null;
  depState?: string;
  /** false forces the per-node probe path (table load "fails"). */
  useTable?: boolean;
}) {
  const root = path.resolve(__dirname, '..', '..');
  const model = new SystemStateModel();
  model.registerComponent('protoforge-core', 'process');
  if (opts.depState) {
    model.updateState('protoforge-core', opts.depState as any, []);
  }
  const emptyGraph = { nodes: new Map() } as unknown as DependencyGraph;
  const checker = new HealthProvenanceChecker(root, model, emptyGraph) as any;

  if (opts.useTable === false) {
    // Table probe failed — exercise the per-node fallback path.
    checker.getProcessTable = jest.fn().mockReturnValue(null);
  } else {
    // Snapshot table: 'unreadable' fixtures are absent rows — a dead
    // process is a resolved chain end, not a probe failure.
    checker.getProcessTable = jest.fn().mockImplementation(() => {
      const map = new Map<string, { name: string; cmdline: string; ppid: string | null }>();
      for (const [pid, info] of Object.entries(opts.processes)) {
        if (info === 'unreadable') continue;
        map.set(pid, { name: info.name, cmdline: info.cmdline, ppid: opts.parents[pid] ?? null });
      }
      return map;
    });
  }

  checker.canConnect = jest.fn().mockResolvedValue(true);
  checker.findPidsOnPort = jest.fn().mockReturnValue(Object.keys(opts.processes).slice(0, 1));
  checker.getProcessInfo = jest.fn().mockImplementation((pid: string) => {
    const p = opts.processes[pid];
    if (!p || p === 'unreadable') return { name: 'unknown', cmdline: 'unknown' };
    return p;
  });
  checker.getParentPid = jest.fn().mockImplementation((pid: string) => opts.parents[pid] ?? null);
  checker.getBootLeasePid = jest.fn().mockReturnValue(opts.bootLeasePid ?? null);
  checker.getRecoveryLeasePid = jest.fn().mockReturnValue(opts.recoveryLeasePid ?? null);
  checker.httpGet = jest.fn().mockResolvedValue({ ok: true, statusCode: 200, body: '{"status":"ok"}' });
  return checker;
}

describe('ancestry-aware process identity', () => {
  it('legitimate grandchild: npm run dev → next dev → start-server chain → HEALTHY', async () => {
    const checker = buildChecker({
      processes: {
        '34012': { name: 'node.exe', cmdline: 'node.exe C:\\app\\node_modules\\next\\dist\\server\\lib\\start-server.js' },
        '9344': { name: 'node.exe', cmdline: 'node C:\\app\\node_modules\\.bin\\..\\next\\dist\\bin\\next dev --port 3000' },
        '20568': { name: 'cmd.exe', cmdline: 'cmd.exe /d /s /c "npm run dev"' },
        '29484': { name: 'node.exe', cmdline: 'node C:\\pm2\\ProcessContainerFork.js' },
      },
      parents: { '34012': '9344', '9344': '20568', '20568': '29484', '29484': '17776' },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('HEALTHY');
    const id = result.evidence.find((e: any) => e.check === 'process-identity');
    expect(id.status).toBe('pass');
  });

  it('legitimate child: leaf mismatch, direct parent matches command family', async () => {
    const checker = buildChecker({
      processes: {
        '500': { name: 'node.exe', cmdline: 'node start-server.js' },
        '400': { name: 'cmd.exe', cmdline: 'cmd /c "npm run dev"' },
      },
      parents: { '500': '400', '400': null },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    const id = result.evidence.find((e: any) => e.check === 'process-identity');
    expect(id.status).toBe('pass');
  });

  it('canonical owner: no cmdline match, but ancestry reaches boot-lease pid → pass', async () => {
    const checker = buildChecker({
      processes: {
        '700': { name: 'node.exe', cmdline: 'node totally-rewritten-entry.js' },
        '600': { name: 'cmd.exe', cmdline: 'cmd /c opaque-wrapper' },
        '29484': { name: 'node.exe', cmdline: 'node ProcessContainerFork.js' },
      },
      parents: { '700': '600', '600': '29484' },
      bootLeasePid: '29484',
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    const id = result.evidence.find((e: any) => e.check === 'process-identity');
    expect(id.status).toBe('pass');
    expect(id.value).toMatch(/boot-agent/);
  });

  it('recovery-lease ancestry: descendant of recorded recovery spawn → pass', async () => {
    const checker = buildChecker({
      processes: {
        '900': { name: 'node.exe', cmdline: 'node start-server.js' },
        '800': { name: 'cmd.exe', cmdline: 'cmd /c some-wrapper' },
      },
      parents: { '900': '800' },
      recoveryLeasePid: '800',
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    const id = result.evidence.find((e: any) => e.check === 'process-identity');
    expect(id.status).toBe('pass');
    expect(id.value).toMatch(/recovery/);
  });

  it('unrelated process on the port: fully-resolved non-matching chain → UNAVAILABLE', async () => {
    const checker = buildChecker({
      processes: {
        '111': { name: 'node.exe', cmdline: 'node other-app/server.js' },
        '222': { name: 'cmd.exe', cmdline: 'cmd /c unrelated-launcher' },
      },
      parents: { '111': '222', '222': null },
      bootLeasePid: '99999',
      recoveryLeasePid: '88888',
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.error).toMatch(/wrong process on port 3000/);
  });

  it('spoofed process name: name says node but cmdline+ancestry are foreign → UNAVAILABLE', async () => {
    const checker = buildChecker({
      processes: {
        '333': { name: 'node.exe', cmdline: 'python evil-service.py --port 3000' },
        '1': { name: 'cmd.exe', cmdline: 'cmd /c foreign' },
      },
      parents: { '333': '1', '1': null },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('UNAVAILABLE');
  });

  it('wrong executable entirely → UNAVAILABLE', async () => {
    const checker = buildChecker({
      processes: { '444': { name: 'python.exe', cmdline: 'python -m http.server 3005' } },
      parents: { '444': null },
    });
    const result = await checker.checkModule(PROTOFORGE);
    expect(result.state).toBe('UNAVAILABLE');
  });

  it('dead ancestor in the snapshot: chain resolves, leaf mismatch → UNAVAILABLE', async () => {
    // In table mode an ancestor absent from the snapshot is a DEAD process —
    // a resolved chain end, not an observation failure. A fully-explored
    // mismatch is a genuine wrong process: restarting the orphan to re-own
    // it under supervision is the designed reconciliation.
    const checker = buildChecker({
      processes: {
        '555': { name: 'node.exe', cmdline: 'node start-server.js' },
        // 666 is not in the snapshot at all — it exited before the table load
      },
      parents: { '555': '666' },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('UNAVAILABLE');
  });

  it('dead/unreadable ancestor via per-node probe → UNKNOWN, not UNAVAILABLE', async () => {
    // Without the table, a node that cannot be read is ambiguous: dead or
    // probe-failed is indistinguishable — fail closed to UNKNOWN.
    const checker = buildChecker({
      useTable: false,
      processes: {
        '555': { name: 'node.exe', cmdline: 'node start-server.js' },
        '666': 'unreadable',
      },
      parents: { '555': '666' },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('UNKNOWN');
    expect(result.error).toMatch(/observer failure/);
    // And crucially: httpGet is not consulted for a verdict it cannot prove.
    expect(checker.httpGet).not.toHaveBeenCalled();
  });

  it('parent probe failure mid-chain (timed-out lookup) → UNKNOWN, NOT UNAVAILABLE', async () => {
    // The live-verified defect: getParentPid timed out under load and looked
    // identical to "no parent" — the chain truncated at the leaf and scored
    // `wrong process` on a canonical service. An errored probe is an
    // observer failure.
    const checker = buildChecker({
      useTable: false,
      processes: { '31696': { name: 'node.exe', cmdline: 'node' } },
      parents: { '31696': 'error' as any },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('UNKNOWN');
    expect(result.state).not.toBe('UNAVAILABLE');
  });

  it('flaky probe on the port owner (the phantom-restart case) → UNKNOWN, NOT UNAVAILABLE', async () => {
    const checker = buildChecker({
      processes: { '1660': 'unreadable' }, // powershell/CIM probe failed
      parents: {},
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(PROTOFORGE);
    // Before the fix this scored `wrong process` → UNAVAILABLE → a healthy
    // service was restarted. UNKNOWN carries no autonomous action.
    expect(result.state).toBe('UNKNOWN');
    expect(result.state).not.toBe('UNAVAILABLE');
  });

  it('direct owner still passes without consulting ancestry', async () => {
    const checker = buildChecker({
      processes: { '777': { name: 'node.exe', cmdline: 'node src/server.js' } },
      parents: {},
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(PROTOFORGE);
    expect(result.state).toBe('HEALTHY');
  });

  it('cyclic ancestry (a pid listing itself as parent) terminates and fails closed', async () => {
    const checker = buildChecker({
      processes: { '888': { name: 'node.exe', cmdline: 'node weird.js' } },
      parents: { '888': '888' },
      depState: 'HEALTHY',
    });
    const result = await checker.checkModule(HEIDI_WEB);
    expect(result.state).toBe('UNAVAILABLE');
  });
});
