'use strict';

const { EventEmitter } = require('events');
const { JobManager, redact, childEnv } = require('../../lib/mobile-ops/job-manager');
const { JOBS } = require('../../lib/mobile-ops/job-catalog');

/** A controllable fake child process. */
function fakeSpawner() {
  const children = [];
  const spawn = jest.fn((cmd, args, opts) => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.pid = 1000 + children.length;
    c.exitCode = null;
    c.signalCode = null;
    c.cmd = cmd;
    c.args = args;
    c.opts = opts;
    c.out = (t) => c.stdout.emit('data', Buffer.from(t));
    c.err = (t) => c.stderr.emit('data', Buffer.from(t));
    c.exit = (code) => {
      c.exitCode = code;
      c.emit('close', code, null);
    };
    children.push(c);
    return c;
  });
  return { spawn, children };
}

const step = (label, extra = {}) => ({ label, cmd: 'tool', args: ['--x'], cwd: '/repo', ...extra });
const catalog = {
  'two.steps': { permission: 'ops:run_tests', confirmRequired: false, summary: 's', timeoutMs: 60_000, steps: () => [step('one'), step('two')] },
  'needs.confirm': { permission: 'ops:run_tests', confirmRequired: true, summary: 's', timeoutMs: 60_000, steps: () => [step('only')] },
  'build.job': { permission: 'ops:build', confirmRequired: true, summary: 's', timeoutMs: 60_000, steps: () => [step('b')] },
  'with.args': {
    permission: 'ops:run_tests',
    confirmRequired: false,
    summary: 's',
    timeoutMs: 60_000,
    steps: (args) => (args.suite === 'ok' ? [step('a')] : { error: 'unknown_suite', allowed: ['ok'] }),
  },
  'short.timeout': { permission: 'ops:run_tests', confirmRequired: false, summary: 's', timeoutMs: 50, steps: () => [step('slow')] },
};

function manager(extra = {}) {
  const fake = fakeSpawner();
  const killTree = jest.fn();
  const jm = new JobManager({ jobs: catalog, spawn: fake.spawn, killTree, root: '/repo', killGraceMs: 10, ...extra });
  return { jm, fake, killTree };
}

describe('JobManager', () => {
  it('runs steps in order, streams output with increasing seq, and succeeds', () => {
    const { jm, fake } = manager();
    const r = jm.start({ kind: 'two.steps', role: 'operator' });
    expect(r.ok).toBe(true);
    const id = r.job.id;
    expect(fake.children).toHaveLength(1);
    fake.children[0].out('hello\nwor');
    fake.children[0].out('ld\n');
    fake.children[0].exit(0);
    expect(fake.children).toHaveLength(2);
    fake.children[1].err('warn line\n');
    fake.children[1].exit(0);
    const g = jm.get({ id, role: 'operator' });
    expect(g.job.state).toBe('succeeded');
    expect(g.job.steps.map((s) => s.state)).toEqual(['succeeded', 'succeeded']);
    const texts = g.lines.map((l) => l.text);
    expect(texts).toContain('hello');
    expect(texts).toContain('world');
    expect(g.lines.find((l) => l.text === 'warn line').stream).toBe('stderr');
    const seqs = g.lines.map((l) => l.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('a cursor returns only lines after it (reconnect resumes exactly)', () => {
    const { jm, fake } = manager();
    const { job } = jm.start({ kind: 'two.steps', role: 'operator' });
    fake.children[0].out('a\nb\n');
    const first = jm.get({ id: job.id, role: 'operator' });
    fake.children[0].out('c\n');
    const second = jm.get({ id: job.id, since: first.next_since, role: 'operator' });
    expect(second.lines.map((l) => l.text)).toEqual(['c']);
    const again = jm.get({ id: job.id, since: second.next_since, role: 'operator' });
    expect(again.lines).toEqual([]);
  });

  it('a failing step fails the job and later steps never run', () => {
    const { jm, fake } = manager();
    const { job } = jm.start({ kind: 'two.steps', role: 'operator' });
    fake.children[0].exit(2);
    const g = jm.get({ id: job.id, role: 'operator' });
    expect(g.job.state).toBe('failed');
    expect(g.job.exit_code).toBe(2);
    expect(g.job.error).toMatch(/one exited with code 2/);
    expect(fake.children).toHaveLength(1);
  });

  it('cancel kills the process tree and ignores the late exit', () => {
    const { jm, fake, killTree } = manager();
    const { job } = jm.start({ kind: 'two.steps', role: 'operator' });
    const c = jm.cancel({ id: job.id, role: 'operator' });
    expect(c.ok).toBe(true);
    expect(c.job.state).toBe('cancelled');
    expect(killTree).toHaveBeenCalledWith(fake.children[0].pid, 'SIGTERM');
    fake.children[0].exit(143);
    expect(jm.get({ id: job.id, role: 'operator' }).job.state).toBe('cancelled');
    expect(fake.children).toHaveLength(1);
  });

  it('times out and kills', async () => {
    const { jm, killTree } = manager();
    const { job } = jm.start({ kind: 'short.timeout', role: 'operator' });
    await new Promise((r) => setTimeout(r, 120));
    expect(jm.get({ id: job.id, role: 'operator' }).job.state).toBe('timed_out');
    expect(killTree).toHaveBeenCalled();
  });

  it('enforces permission, confirmation, argument allowlists and unknown kinds', () => {
    const { jm } = manager();
    expect(jm.start({ kind: 'two.steps', role: 'viewer' }).error).toBe('forbidden');
    expect(jm.start({ kind: 'needs.confirm', role: 'operator' }).error).toBe('confirmation_required');
    expect(jm.start({ kind: 'nope', role: 'owner' }).error).toBe('invalid_job');
    expect(jm.start({ kind: '__proto__', role: 'owner' }).error).toBe('invalid_job');
    const bad = jm.start({ kind: 'with.args', args: { suite: 'rm -rf /' }, role: 'operator' });
    expect(bad).toMatchObject({ ok: false, error: 'unknown_suite', allowed: ['ok'] });
    expect(jm.start({ kind: 'build.job', confirm: true, role: 'agent' }).error).toBe('forbidden');
    expect(jm.start({ kind: 'build.job', confirm: true, role: 'operator' }).ok).toBe(true);
  });

  it('one running job per kind, and at most two overall', () => {
    const { jm } = manager();
    expect(jm.start({ kind: 'two.steps', role: 'operator' }).ok).toBe(true);
    expect(jm.start({ kind: 'two.steps', role: 'operator' }).error).toBe('busy');
    expect(jm.start({ kind: 'needs.confirm', confirm: true, role: 'operator' }).ok).toBe(true);
    expect(jm.start({ kind: 'with.args', args: { suite: 'ok' }, role: 'operator' }).error).toBe('busy');
  });

  it('bounds the log and reports the gap to a client that fell behind', () => {
    const { jm, fake } = manager({ maxLogBytes: 400 });
    const { job } = jm.start({ kind: 'two.steps', role: 'operator' });
    const early = jm.get({ id: job.id, role: 'operator' });
    for (let i = 0; i < 100; i++) fake.children[0].out(`line ${i}\n`);
    const g = jm.get({ id: job.id, since: early.next_since, role: 'operator' });
    expect(g.job.truncated).toBe(true);
    expect(g.gap).toBe(true);
    expect(g.lines[g.lines.length - 1].text).toBe('line 99');
  });

  it('redacts credentials in output', () => {
    const { jm, fake } = manager();
    const { job } = jm.start({ kind: 'two.steps', role: 'operator' });
    // Assembled at runtime so the repo's secret scan (no-hardcoded-secrets) doesn't flag the fixture.
    const fakeStripeKey = ['sk', 'live', 'FAKEKEYFORTEST0123456789'].join('_');
    fake.children[0].out(`key ${fakeStripeKey} and Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n`);
    fake.children[0].out('STRIPE_SECRET_KEY=whsec_123456 postgres://u:pw@db/x\n');
    const text = jm.get({ id: job.id, role: 'operator' }).lines.map((l) => l.text).join('\n');
    expect(text).not.toMatch(/abcdefghijklmnop|whsec_123456|:pw@/);
    expect(text).not.toContain(fakeStripeKey);
    expect(text).toMatch(/\[REDACTED\]/);
  });

  it('children get an environment without credential-looking variables', () => {
    process.env.TEST_SERVICE_SECRET_X = 'nope';
    process.env.SUPABASE_SERVICE_ROLE_KEY_TEST = 'nope';
    try {
      const env = childEnv({ APP_VARIANT: 'development' });
      expect(env.TEST_SERVICE_SECRET_X).toBeUndefined();
      expect(env.SUPABASE_SERVICE_ROLE_KEY_TEST).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.APP_VARIANT).toBe('development');
    } finally {
      delete process.env.TEST_SERVICE_SECRET_X;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY_TEST;
    }
  });

  it('spawns with the catalog argv and no shell on POSIX', () => {
    const { jm, fake } = manager();
    jm.start({ kind: 'two.steps', role: 'operator' });
    const c = fake.children[0];
    expect(c.cmd).toBe('tool');
    expect(c.args).toEqual(['--x']);
    if (process.platform !== 'win32') {
      expect(c.opts.shell).toBe(false);
      expect(c.opts.detached).toBe(true);
    }
  });

  it('viewers can list/read jobs but get no startable catalog entries', () => {
    const { jm } = manager();
    expect(jm.catalogFor('viewer')).toEqual([]);
    expect(jm.catalogFor('operator').map((c) => c.kind)).toContain('build.job');
    const { job } = jm.start({ kind: 'two.steps', role: 'operator' });
    expect(jm.get({ id: job.id, role: 'viewer' }).ok).toBe(true);
    expect(jm.cancel({ id: job.id, role: 'viewer' }).error).toBe('forbidden');
  });
});

const posix = process.platform === 'win32' ? describe.skip : describe;
posix('JobManager with real processes', () => {
  const real = (script, timeoutMs = 30_000) =>
    new JobManager({
      root: process.cwd(),
      killGraceMs: 500,
      jobs: {
        real: { permission: 'ops:run_tests', confirmRequired: false, summary: 's', timeoutMs, steps: () => [{ label: 'node', cmd: process.execPath, args: ['-e', script], cwd: process.cwd() }] },
      },
    });
  const waitFor = async (fn, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('captures real output and exit code', async () => {
    const jm = real("console.log('out-1'); console.error('err-1'); process.exit(0)");
    const { job } = jm.start({ kind: 'real', role: 'operator' });
    expect(await waitFor(() => jm.get({ id: job.id, role: 'operator' }).job.state === 'succeeded')).toBe(true);
    const texts = jm.get({ id: job.id, role: 'operator' }).lines.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining(['out-1', 'err-1']));
  });

  it('cancel kills the whole process tree, including grandchildren', async () => {
    // The child spawns a long-lived grandchild and prints its pid.
    const script = `const {spawn}=require('child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('GRANDCHILD '+g.pid);setInterval(()=>{},1000);`;
    const jm = real(script);
    const { job } = jm.start({ kind: 'real', role: 'operator' });
    let gpid = null;
    await waitFor(() => {
      const l = jm.get({ id: job.id, role: 'operator' }).lines.find((x) => x.text.startsWith('GRANDCHILD '));
      if (l) gpid = Number(l.text.split(' ')[1]);
      return gpid !== null;
    });
    expect(alive(gpid)).toBe(true);
    jm.cancel({ id: job.id, role: 'operator' });
    expect(await waitFor(() => !alive(gpid), 5000)).toBe(true);
  });

  it('a hung process is killed at the timeout', async () => {
    const jm = real('setInterval(()=>{},1000)', 300);
    const { job } = jm.start({ kind: 'real', role: 'operator' });
    expect(await waitFor(() => jm.get({ id: job.id, role: 'operator' }).job.state === 'timed_out', 3000)).toBe(true);
  });
});

describe('job catalog', () => {
  it('every job has a fixed, non-empty argv and a permission', () => {
    for (const [kind, def] of Object.entries(JOBS)) {
      const steps = def.steps(kind === 'tests.suite' ? { suite: 'mobile-ops' } : {}, '/repo');
      expect(Array.isArray(steps)).toBe(true);
      for (const s of steps) {
        expect(typeof s.cmd).toBe('string');
        expect(Array.isArray(s.args)).toBe(true);
        // path.join emits backslashes on Windows hosts — normalize before
        // asserting the step runs inside the repo dir.
        expect(s.cwd.replace(/\\/g, '/').startsWith('/repo')).toBe(true);
      }
      expect(def.permission).toMatch(/^ops:/);
    }
  });

  it('suite names are an allowlist; anything else is rejected', () => {
    expect(JOBS['tests.suite'].steps({ suite: '../../etc' }, '/repo')).toMatchObject({ error: 'unknown_suite' });
    expect(JOBS['tests.suite'].steps({}, '/repo')).toMatchObject({ error: 'unknown_suite' });
  });

  it('the Android build needs ops:build and confirmation', () => {
    expect(JOBS['walkie.android.build'].permission).toBe('ops:build');
    expect(JOBS['walkie.android.build'].confirmRequired).toBe(true);
  });

  it('redact() leaves ordinary build output alone', () => {
    expect(redact('BUILD SUCCESSFUL in 36s')).toBe('BUILD SUCCESSFUL in 36s');
    expect(redact('> Task :app:assembleDebug')).toBe('> Task :app:assembleDebug');
  });
});
