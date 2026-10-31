'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { maybeHealKong } = require('../../lib/supabase/kong-heal');

function makeDeps(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kong-heal-'));
  return {
    supabaseUrl: 'http://127.0.0.1:54321',
    stateFile: path.join(dir, 'last.json'),
    recheckDelayMs: 0,
    log: jest.fn(),
    ...overrides,
  };
}

const refused = () => { throw new Error('fetch failed'); };
const reachable = jest.fn(async () => 200);
const kongUp = jest.fn(async (args) => args[0] === 'ps'
  ? 'supabase_kong_HYDI-System-v2 Up 6 hours\nsupabase_db_HYDI-System-v2 Up 6 hours\n'
  : 'supabase_kong_HYDI-System-v2');

describe('kong-heal', () => {
  it('does nothing when REST answers', async () => {
    const docker = jest.fn();
    const r = await maybeHealKong(makeDeps({ fetcher: reachable, dockerRunner: docker }));
    expect(r.action).toBe('none');
    expect(docker).not.toHaveBeenCalled();
  });

  it('restarts exactly the kong container when REST is refused and it is Up', async () => {
    const calls = [];
    const docker = jest.fn(async (args) => {
      calls.push(args.join(' '));
      return kongUp.mockImplementation(() => {}) ? '' : '';
    });
    docker.mockImplementation(async (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'ps') return 'supabase_kong_HYDI-System-v2 Up 6 hours\nsupabase_db_HYDI-System-v2 Up 6 hours\n';
      return 'supabase_kong_HYDI-System-v2';
    });
    const fetcher = jest.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(200);
    const r = await maybeHealKong(makeDeps({ fetcher, dockerRunner: docker }));
    expect(r.action).toBe('recovered');
    expect(r.container).toBe('supabase_kong_HYDI-System-v2');
    // Exactly one restart of exactly the kong container - nothing else touched.
    expect(calls.filter((c) => c.startsWith('restart'))).toEqual(['restart supabase_kong_HYDI-System-v2']);
    expect(calls.filter((c) => /supabase_(db|auth|storage|rest|realtime|inbucket|pg_meta|studio)/.test(c))).toEqual([]);
  });

  it('does not restart again inside the cooldown', async () => {
    const deps = makeDeps();
    fs.writeFileSync(deps.stateFile, JSON.stringify({ lastAttemptAt: new Date().toISOString() }));
    const docker = jest.fn(async (args) => args[0] === 'ps' ? 'supabase_kong_HYDI-System-v2 Up' : '');
    const fetcher = jest.fn(refused);
    const r = await maybeHealKong({ ...deps, fetcher, dockerRunner: docker });
    expect(r.action).toBe('rate-limited');
    expect(docker.mock.calls.filter((c) => c[0] === 'restart')).toEqual([]);
  });

  it('does nothing when REST is refused but no kong container is Up', async () => {
    const docker = jest.fn(async (args) => args[0] === 'ps' ? 'supabase_db_X Up\nother_svc Exited' : '');
    const r = await maybeHealKong(makeDeps({ fetcher: jest.fn(refused), dockerRunner: docker }));
    expect(r.action).toBe('none');
    expect(docker.mock.calls.filter((c) => c[0] === 'restart')).toEqual([]);
  });

  it('401 from REST counts as reachable - no restart', async () => {
    const docker = jest.fn();
    const fetcher = jest.fn(async () => 401);
    const r = await maybeHealKong(makeDeps({ fetcher, dockerRunner: docker }));
    expect(r.action).toBe('none');
    expect(r.reason).toContain('401');
    expect(docker).not.toHaveBeenCalled();
  });

  it('timeout + kong Up restarts exactly once', async () => {
    const calls = [];
    const docker = jest.fn(async (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'ps') return 'supabase_kong_X Up 2 minutes';
      return 'supabase_kong_X';
    });
    const fetcher = jest.fn()
      .mockRejectedValueOnce(new DOMException('TimeoutError', 'TimeoutError'))
      .mockResolvedValueOnce(200);
    const r = await maybeHealKong(makeDeps({ fetcher, dockerRunner: docker, recheckDelayMs: 0 }));
    expect(r.action).toBe('recovered');
    expect(calls.filter((c) => c.startsWith('restart'))).toEqual(['restart supabase_kong_X']);
  });

  it('never restarts a non-kong supabase container', async () => {
    const calls = [];
    const docker = jest.fn(async (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'ps') return 'supabase_rest_X Up\nsupabase_db_X Up\nsupabase_kong_X Up';
      return '';
    });
    const fetcher = jest.fn(refused);
    const r = await maybeHealKong(makeDeps({ fetcher, dockerRunner: docker, recheckDelayMs: 0 }));
    expect(r.action).toBe('still-refused');
    expect(calls.filter((c) => c.startsWith('restart'))).toEqual(['restart supabase_kong_X']);
  });
});

describe('kong-heal log lines', () => {
  const { sanitizeLogLine } = require('../../lib/supabase/kong-heal');

  it('flattens newlines and control characters so one call is one line', () => {
    const out = sanitizeLogLine('kong-heal: docker ps failed (boom\n2026-01-01T00:00:00Z kong-heal: recovered\r\u0007)');
    expect(out).not.toMatch(/[\n\r\u0007]/);
    expect(out).toContain('boom 2026-01-01T00:00:00Z');
  });

  it('caps very long lines', () => {
    const out = sanitizeLogLine('x'.repeat(5000));
    expect(out.length).toBe(501);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary line unchanged', () => {
    expect(sanitizeLogLine('kong-heal: none (rest reachable (HTTP 200))')).toBe('kong-heal: none (rest reachable (HTTP 200))');
  });
});
