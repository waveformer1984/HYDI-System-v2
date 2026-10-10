/**
 * Regression tests for boot-agent.js classifyOccupant()'s ancestry-aware
 * identity check (the adoption-side twin of HealthProvenanceChecker's
 * process-identity fix).
 *
 * Live defect, 2026-09-19 PM2 daemon recovery: the leaf-only identity check
 * would classify a legitimately wrapper-launched heidi-web orphan
 * (`start-server.js` holds :3000; `npm run dev` only appears on an ancestor
 * cmd.exe/npm wrapper) as `wrong-process` → required module → shutdown(1) →
 * PM2 restart loop. It did not fire that day only because preflight zombie
 * cleanup removed the occupant first.
 *
 * Contract:
 *   - command-family match on the leaf OR any ancestor → identity proven
 *   - ancestry to this boot-agent → 'supervised'
 *   - ancestry to a valid recovery lease → 'recovered'
 *   - fully explored chain with no match → 'wrong-process' (proven foreign)
 *   - chain truncated by an unreadable node → 'unsupervised' (observer
 *     failure is never proof of foreignness)
 */

'use strict';

jest.mock('../../scripts/process-identity', () => ({
  findPidsOnPort: jest.fn(),
  getProcessInfo: jest.fn(),
  isDescendantOf: jest.fn(),
}));

const identity = require('../../scripts/process-identity');
const { classifyOccupant } = require('../../scripts/boot-agent');

const HEIDI_WEB = { id: 'heidi-web', command: 'npm', args: ['run', 'dev'], port: 3000 };
const PROTOFORGE = { id: 'protoforge-core', command: 'node', args: ['src/server.js'], port: 3005 };

beforeEach(() => jest.clearAllMocks());

/** A getProcessInfo() record. cmdline=null marks a fully unreadable node. */
function proc(pid, cmdline, ppid, name = 'node.exe') {
  return {
    pid: String(pid),
    name: cmdline == null ? null : name,
    cmdline: cmdline == null ? null : cmdline,
    ppid: ppid == null ? null : String(ppid),
  };
}

/** Wire getProcessInfo to answer per-pid from a record map (absent = unreadable). */
function table(map) {
  identity.getProcessInfo.mockImplementation((pid) => {
    const rec = map[String(pid)];
    if (!rec) return { pid: String(pid), name: null, cmdline: null, ppid: null };
    return rec;
  });
}

describe('classifyOccupant — ancestry-aware identity', () => {
  it('wrapped launch: leaf is start-server.js, ancestor is `npm run dev` → not wrong-process', async () => {
    identity.findPidsOnPort.mockReturnValue(['31696']);
    table({
      '31696': proc('31696', 'node start-server.js', '25588'),
      '25588': proc('25588', 'node next dev --port 3000', '30708'),
      '30708': proc('30708', 'cmd.exe /d /s /c next dev', '19268', 'cmd.exe'),
      '19268': proc('19268', 'node npm-cli.js run dev', '7636'),
      '7636': proc('7636', 'cmd.exe /d /s /c "npm run dev"', '10756', 'cmd.exe'),
    });
    identity.isDescendantOf.mockReturnValue(true);

    const r = await classifyOccupant(HEIDI_WEB);
    expect(r.ownership).toBe('supervised');
  });

  it('direct leaf match → supervised when descended from this boot-agent', async () => {
    identity.findPidsOnPort.mockReturnValue(['16976']);
    table({
      '16976': proc('16976', 'node src/server.js', '17996'),
      '17996': proc('17996', 'cmd /c node src/server.js', '10756', 'cmd.exe'),
    });
    identity.isDescendantOf.mockReturnValue(true);

    const r = await classifyOccupant(PROTOFORGE);
    expect(r.ownership).toBe('supervised');
  });

  it('fully-resolved foreign chain → wrong-process (squatter protection intact)', async () => {
    identity.findPidsOnPort.mockReturnValue(['111']);
    table({
      '111': proc('111', 'node other-app/server.js', '222'),
      '222': proc('222', 'cmd /c unrelated-launcher', null, 'cmd.exe'),
    });

    const r = await classifyOccupant(HEIDI_WEB);
    expect(r.ownership).toBe('wrong-process');
    expect(identity.isDescendantOf).not.toHaveBeenCalled();
  });

  it('chain truncated by unreadable ancestor → unsupervised, never wrong-process', async () => {
    identity.findPidsOnPort.mockReturnValue(['555']);
    table({
      '555': proc('555', 'node start-server.js', '666'),
      // 666 absent — exited/unreadable; the walk cannot see past it
    });

    const r = await classifyOccupant(HEIDI_WEB);
    expect(r.ownership).toBe('unsupervised');
  });

  it('unreadable leaf → unsupervised', async () => {
    identity.findPidsOnPort.mockReturnValue(['999']);
    table({ '999': proc('999', null, null) });

    const r = await classifyOccupant(HEIDI_WEB);
    expect(r.ownership).toBe('unsupervised');
  });

  it('ancestor identity match + no boot ancestry + valid recovery lease → recovered', async () => {
    identity.findPidsOnPort.mockReturnValue(['900']);
    table({
      '900': proc('900', 'node start-server.js', '800'),
      '800': proc('800', 'cmd /c "npm run dev"', null, 'cmd.exe'),
    });
    // not a descendant of this boot-agent, but is a descendant of lease pid 800
    identity.isDescendantOf.mockImplementation((pid, ancestor) =>
      String(ancestor) === '800');

    // A real recovery lease for the wrapper pid (jest.setup redirects the
    // lease dir to a temp path; write one through the real module).
    const rl = require('../../scripts/recovery-lease');
    rl.record('heidi-web', { pid: 800, command: 'cmd', args: ['/c', 'npm run dev'], recoveredBy: 'test', cause: 'fixture' });

    try {
      const r = await classifyOccupant(HEIDI_WEB);
      expect(r.ownership).toBe('recovered');
    } finally {
      rl.clear('heidi-web');
    }
  });

  it('ancestor identity match, no descent, no lease → unsupervised (visible, not rejected)', async () => {
    identity.findPidsOnPort.mockReturnValue(['700']);
    table({
      '700': proc('700', 'node start-server.js', '600'),
      '600': proc('600', 'cmd /c "npm run dev"', null, 'cmd.exe'),
    });
    identity.isDescendantOf.mockReturnValue(false);

    const r = await classifyOccupant(HEIDI_WEB);
    expect(r.ownership).toBe('unsupervised');
  });

  it('cyclic ancestry (pid is its own parent) terminates and still classifies', async () => {
    identity.findPidsOnPort.mockReturnValue(['888']);
    table({ '888': proc('888', 'node weird.js', '888') });

    const r = await classifyOccupant(HEIDI_WEB);
    expect(r.ownership).toBe('wrong-process'); // cycle = resolved end; no match is proven foreign
  });
});
