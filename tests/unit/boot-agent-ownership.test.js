'use strict';

/**
 * Regression tests for scripts/boot-agent.js's `classifyOccupant()` — the
 * ownership classification applied to a port that is already occupied and
 * healthy at boot time.
 *
 * The defect this locks down (2026-09-10 runtime truth sweep + follow-up
 * investigation): before `classifyOccupant()` existed, a healthy HTTP
 * response on the configured port was BY ITSELF sufficient for boot-agent to
 * classify a required module `external: true` -- no PID was captured, no
 * identity was checked, no ancestry was checked. That is how a supervised
 * protoforge-core instance (PID 4568) exited and was invisibly replaced by
 * an unrelated orphan (PID 25324, a `node src/server.js` child of a
 * since-exited Jest process) that happened to implement the identical
 * service and so answered the identical health check.
 *
 * `scripts/process-identity.js` is fully mocked -- these tests never shell
 * out to a real `netstat`/PowerShell, and never touch a real process. They
 * exercise `classifyOccupant` by `require()`-ing `boot-agent.js` itself,
 * which is safe only because of the `require.main === module` guard added
 * alongside this fix: requiring the file no longer auto-executes `main()`
 * (claims the boot lease, supersedes any running canonical instance, and
 * spawns/kills real processes). Without that guard this test file could not
 * exist without restarting the real system on every run.
 */

jest.mock('../../scripts/process-identity');
jest.mock('../../scripts/recovery-lease');
const identity = require('../../scripts/process-identity');
const recoveryLease = require('../../scripts/recovery-lease');
const { classifyOccupant } = require('../../scripts/boot-agent');

const PROTOFORGE_CORE = {
  id: 'protoforge-core',
  type: 'process',
  required: true,
  command: 'node',
  args: ['src/server.js'],
  port: 3005,
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('classifyOccupant: Test A -- correct process, supervised, accepted', () => {
  it('healthy + correct identity + ancestry to this boot-agent => supervised', async () => {
    identity.findPidsOnPort.mockReturnValue(['27608']);
    identity.getProcessInfo.mockReturnValue({ pid: '27608', name: 'node.exe', cmdline: 'node src/server.js', ppid: String(process.pid) });
    identity.isDescendantOf.mockReturnValue(true);

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('supervised');
    expect(result.pid).toBe('27608');
    expect(identity.isDescendantOf).toHaveBeenCalledWith('27608', process.pid);
  });
});

describe('classifyOccupant: Test B -- healthy unrelated node process, wrong script', () => {
  it('HTTP-healthy + node executable + wrong script => NOT accepted as this service', async () => {
    identity.findPidsOnPort.mockReturnValue(['9999']);
    // A real node process, running something else entirely -- exactly the
    // shape of process that the old `cmdline.includes('node')` fallback
    // would have wrongly accepted as "the expected process".
    identity.getProcessInfo.mockReturnValue({ pid: '9999', name: 'node.exe', cmdline: 'node scripts/some-unrelated-tool.js', ppid: '1' });

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('wrong-process');
    expect(result.pid).toBe('9999');
    // Ancestry must never even be consulted for a process that already
    // fails identity -- ownership cannot rescue the wrong service.
    expect(identity.isDescendantOf).not.toHaveBeenCalled();
  });

  it('a bare command-name match is not enough on its own (the exact closed loophole)', async () => {
    identity.findPidsOnPort.mockReturnValue(['1']);
    // cmdline contains "node" (the configured command) but not the
    // configured script -- this is precisely what the old
    // `cmdlineLower.includes('node')` fallback treated as a pass.
    identity.getProcessInfo.mockReturnValue({ pid: '1', name: 'node.exe', cmdline: 'node --version', ppid: '1' });

    const result = await classifyOccupant(PROTOFORGE_CORE);
    expect(result.ownership).toBe('wrong-process');
  });
});

describe('classifyOccupant: Test C -- healthy, correct service, no HYDI ancestry', () => {
  it('correct identity + healthy + ancestry does NOT trace to this boot-agent => unsupervised', async () => {
    // This is the actual incident, reconstructed: PID 25324 really is
    // `node src/server.js`, but its parent chain roots in a since-exited
    // Jest process, not this boot-agent.
    identity.findPidsOnPort.mockReturnValue(['25324']);
    identity.getProcessInfo.mockReturnValue({ pid: '25324', name: 'node.exe', cmdline: 'node src/server.js', ppid: '17060' });
    identity.isDescendantOf.mockReturnValue(false);

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('unsupervised');
    expect(result.pid).toBe('25324');
  });

  it('no PID attributable to the port at all => unsupervised, not silently accepted', async () => {
    // e.g. a stale TIME_WAIT, a portproxy, or a container port mapping --
    // the port answers but netstat cannot name an owner.
    identity.findPidsOnPort.mockReturnValue([]);

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('unsupervised');
    expect(result.pid).toBeNull();
    expect(identity.getProcessInfo).not.toHaveBeenCalled();
  });

  it('a PID is found but its identity cannot be read => unsupervised, not accepted, not rejected', async () => {
    identity.findPidsOnPort.mockReturnValue(['404']);
    identity.getProcessInfo.mockReturnValue({ pid: '404', name: null, cmdline: null, ppid: null });

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('unsupervised');
    expect(identity.isDescendantOf).not.toHaveBeenCalled();
  });
});

describe('classifyOccupant: Test D -- PID replacement is detectable', () => {
  it('the same module classified twice, before and after the underlying PID changes, produces different ownership evidence', async () => {
    // Before: the canonical, supervised instance.
    identity.findPidsOnPort.mockReturnValue(['4568']);
    identity.getProcessInfo.mockReturnValue({ pid: '4568', name: 'node.exe', cmdline: 'node src/server.js', ppid: String(process.pid) });
    identity.isDescendantOf.mockReturnValue(true);
    const before = await classifyOccupant(PROTOFORGE_CORE);
    expect(before).toMatchObject({ ownership: 'supervised', pid: '4568' });

    // After: PID 4568 exited: it has been silently replaced by an orphan
    // that happens to answer the same health check.
    identity.findPidsOnPort.mockReturnValue(['25324']);
    identity.getProcessInfo.mockReturnValue({ pid: '25324', name: 'node.exe', cmdline: 'node src/server.js', ppid: '17060' });
    identity.isDescendantOf.mockReturnValue(false);
    const after = await classifyOccupant(PROTOFORGE_CORE);
    expect(after).toMatchObject({ ownership: 'unsupervised', pid: '25324' });

    // The two classifications disagree on both PID and ownership -- a
    // caller diffing successive classifications (the continuous-monitoring
    // follow-up described in the investigation) can detect the swap from
    // this alone.
    expect(after.pid).not.toBe(before.pid);
    expect(after.ownership).not.toBe(before.ownership);
  });
});

describe('classifyOccupant: Test E -- module without configured args', () => {
  it('a module with no declared args is identified by command alone (no script to compare)', async () => {
    const moduleWithoutArgs = { id: 'legacy-tool', type: 'process', required: false, command: 'python', port: 8080 };
    identity.findPidsOnPort.mockReturnValue(['555']);
    identity.getProcessInfo.mockReturnValue({ pid: '555', name: 'python.exe', cmdline: 'python -m http.server 8080', ppid: String(process.pid) });
    identity.isDescendantOf.mockReturnValue(true);

    const result = await classifyOccupant(moduleWithoutArgs);
    expect(result.ownership).toBe('supervised');
  });

  it('still rejects a different command entirely even with no args configured', async () => {
    const moduleWithoutArgs = { id: 'legacy-tool', type: 'process', required: false, command: 'python', port: 8080 };
    identity.findPidsOnPort.mockReturnValue(['555']);
    identity.getProcessInfo.mockReturnValue({ pid: '555', name: 'node.exe', cmdline: 'node unrelated-server.js', ppid: '1' });

    const result = await classifyOccupant(moduleWithoutArgs);
    expect(result.ownership).toBe('wrong-process');
  });
});

describe('classifyOccupant: Test F -- RecoveryEngine-recovered process is explained, not a mystery', () => {
  it('correct identity + no ancestry to this boot-agent + a matching lease (exact PID) => recovered, not unsupervised', async () => {
    identity.findPidsOnPort.mockReturnValue(['28068']);
    identity.getProcessInfo.mockReturnValue({ pid: '28068', name: 'node.exe', cmdline: 'node src/server.js', ppid: '27864' });
    identity.isDescendantOf.mockReturnValue(false); // not this boot-agent's own child
    recoveryLease.getValidLease.mockReturnValue({
      component: 'protoforge-core', pid: '28068', recoveredAt: '2026-09-12T13:16:00.000Z',
      recoveredBy: 'RecoveryEngine.restartProcess', cause: null,
    });

    const result = await classifyOccupant(PROTOFORGE_CORE);
    expect(result.ownership).toBe('recovered');
    expect(result.recoveredAt).toBe('2026-09-12T13:16:00.000Z');
    expect(result.recoveredBy).toBe('RecoveryEngine.restartProcess');
  });

  it('correct identity + a lease naming the shell-wrapper PID (ancestor, not the final PID) => still recovered', async () => {
    // spawn(..., {shell:true})'s child.pid on Windows is the cmd.exe
    // wrapper, not the final node.exe bound to the port -- the lease
    // records that wrapper PID, so matching must be by ancestry, not
    // equality. This is the exact shape the real incident produced.
    identity.findPidsOnPort.mockReturnValue(['28068']);
    identity.getProcessInfo.mockReturnValue({ pid: '28068', name: 'node.exe', cmdline: 'node src/server.js', ppid: '27864' });
    identity.isDescendantOf.mockImplementation((pid, ancestor) => String(pid) === '28068' && String(ancestor) === '27864');
    recoveryLease.getValidLease.mockReturnValue({
      component: 'protoforge-core', pid: '27864', recoveredAt: new Date().toISOString(),
      recoveredBy: 'RecoveryEngine.restartProcess', cause: null,
    });

    const result = await classifyOccupant(PROTOFORGE_CORE);
    expect(result.ownership).toBe('recovered');
  });

  it('a stale or absent lease still falls back to unsupervised -- explanation must be current, not assumed', async () => {
    identity.findPidsOnPort.mockReturnValue(['28068']);
    identity.getProcessInfo.mockReturnValue({ pid: '28068', name: 'node.exe', cmdline: 'node src/server.js', ppid: '27864' });
    identity.isDescendantOf.mockReturnValue(false);
    recoveryLease.getValidLease.mockReturnValue(null); // getValidLease itself already excludes stale entries

    const result = await classifyOccupant(PROTOFORGE_CORE);
    expect(result.ownership).toBe('unsupervised');
  });

  it('a lease for a DIFFERENT PID does not explain this occupant', async () => {
    identity.findPidsOnPort.mockReturnValue(['99999']);
    identity.getProcessInfo.mockReturnValue({ pid: '99999', name: 'node.exe', cmdline: 'node src/server.js', ppid: '1' });
    identity.isDescendantOf.mockReturnValue(false);
    recoveryLease.getValidLease.mockReturnValue({
      component: 'protoforge-core', pid: '28068', recoveredAt: new Date().toISOString(), recoveredBy: 'RecoveryEngine.restartProcess',
    });

    const result = await classifyOccupant(PROTOFORGE_CORE);
    expect(result.ownership).toBe('unsupervised');
  });
});

describe('classifyOccupant: Test G -- a recovery lease cannot outlive or misattribute the process it names', () => {
  it('Property 1: the recovered PID has died (nothing on the port) => unsupervised, and the lease is never even consulted', async () => {
    identity.findPidsOnPort.mockReturnValue([]); // the recovered process is gone; nothing is listening
    recoveryLease.getValidLease.mockReturnValue({
      component: 'protoforge-core', pid: '28068', recoveredAt: new Date().toISOString(), recoveredBy: 'RecoveryEngine.restartProcess',
    });

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('unsupervised');
    // The port-empty branch returns before identity or lease are ever
    // examined -- a lease naming a PID that is no longer on the port
    // cannot influence this classification at all, not just "loses a tiebreak".
    expect(identity.getProcessInfo).not.toHaveBeenCalled();
    expect(recoveryLease.getValidLease).not.toHaveBeenCalled();
  });

  it('Properties 2 & 4: a lease exists naming this PID, but the CURRENT occupant is a different process => wrong-process, never recovered', async () => {
    // The adversarial PID-reuse case: Windows reassigns the exact PID (or an
    // ancestor) the lease names to something else entirely, which now also
    // happens to occupy the port.
    identity.findPidsOnPort.mockReturnValue(['28068']);
    identity.getProcessInfo.mockReturnValue({ pid: '28068', name: 'python.exe', cmdline: 'python -m http.server 3005', ppid: '1' });
    recoveryLease.getValidLease.mockReturnValue({
      component: 'protoforge-core', pid: '28068', recoveredAt: new Date().toISOString(), recoveredBy: 'RecoveryEngine.restartProcess',
    });

    const result = await classifyOccupant(PROTOFORGE_CORE);

    expect(result.ownership).toBe('wrong-process');
    // Identity is checked unconditionally before ancestry or lease -- a
    // matching PID in a stale lease can never rescue a failed identity
    // check, structurally, not just in this one test's mock values.
    expect(identity.isDescendantOf).not.toHaveBeenCalled();
    expect(recoveryLease.getValidLease).not.toHaveBeenCalled();
  });

  it('Property 3 (real, unmocked recovery-lease module): a genuinely stale lease on disk is ignored, not just a mocked null', async () => {
    jest.resetModules();
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-lease-integration-'));
    const originalEnv = process.env.RECOVERY_LEASE_DIR;
    process.env.RECOVERY_LEASE_DIR = dir;
    try {
      const realLease = jest.requireActual('../../scripts/recovery-lease');
      realLease.record('protoforge-core', { pid: '28068' });
      // Back-date it past the default 24h staleness window.
      const stalePath = path.join(dir, 'protoforge-core.json');
      const entry = JSON.parse(fs.readFileSync(stalePath, 'utf8'));
      entry.recoveredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(stalePath, JSON.stringify(entry));

      // Wire classifyOccupant's mocked recovery-lease dependency to delegate
      // to this real, isolated instance for this one test only.
      recoveryLease.getValidLease.mockImplementation(realLease.getValidLease);
      identity.findPidsOnPort.mockReturnValue(['28068']);
      identity.getProcessInfo.mockReturnValue({ pid: '28068', name: 'node.exe', cmdline: 'node src/server.js', ppid: '27864' });
      identity.isDescendantOf.mockReturnValue(false);

      const result = await classifyOccupant(PROTOFORGE_CORE);
      expect(result.ownership).toBe('unsupervised');
    } finally {
      if (originalEnv === undefined) delete process.env.RECOVERY_LEASE_DIR;
      else process.env.RECOVERY_LEASE_DIR = originalEnv;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Property 5, stated honestly as a known limitation (NOT a safety guarantee): a coincidental same-PID, same-identity respawn within the staleness window IS misclassified as recovered', async () => {
    // The lease records {component, pid, command, args, recoveredAt,
    // recoveredBy, cause} -- no process-start-timestamp, no spawn nonce, no
    // binary hash. If an entirely unrelated process happens to (a) land on
    // the exact PID the lease names (or a descendant of it) AND (b) run the
    // identical configured command+script, within the 24h staleness window,
    // nothing in this implementation can tell it apart from the original
    // recovered process. This is a real, accepted residual gap, not a
    // false-safe test -- it exists so the limitation is provable and
    // visible rather than only described in a comment.
    identity.findPidsOnPort.mockReturnValue(['28068']);
    identity.getProcessInfo.mockReturnValue({ pid: '28068', name: 'node.exe', cmdline: 'node src/server.js', ppid: '1' }); // unrelated ancestry, same identity
    identity.isDescendantOf.mockReturnValue(false);
    recoveryLease.getValidLease.mockReturnValue({
      component: 'protoforge-core', pid: '28068', recoveredAt: new Date().toISOString(), recoveredBy: 'RecoveryEngine.restartProcess',
    });

    const result = await classifyOccupant(PROTOFORGE_CORE);

    // This assertion documents the gap, it does not endorse it: closing it
    // would require the lease to carry additional identity signal (e.g. the
    // process's own start time) that scripts/process-identity.js does not
    // currently capture -- a real follow-up, not implemented here per the
    // instruction to verify existing behavior rather than change code.
    expect(result.ownership).toBe('recovered');
  });
});
