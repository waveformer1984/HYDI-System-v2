'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runHydiDoctor,
  formatDoctorTable,
  formatNotifyBody,
  shouldNotify,
  isDoctorQuery,
  formatDoctorChat,
  saveDoctorLatest,
} = require('../../lib/hydi/doctor');

function mockFetch(routes) {
  return async (url, init) => {
    const key = typeof url === 'string' ? url : String(url);
    const hit = Object.keys(routes).find((p) => key.includes(p));
    if (!hit) {
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => null, text: async () => '' };
    }
    return routes[hit](key, init);
  };
}

describe('hydi-doctor', () => {
  it('isDoctorQuery matches chat command', () => {
    expect(isDoctorQuery('doctor')).toBe(true);
    expect(isDoctorQuery('hydi doctor')).toBe(true);
    expect(isDoctorQuery('fix list')).toBe(false);
  });

  it('formatDoctorChat reads latest.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-chat-'));
    const report = { ts: new Date().toISOString(), summary: { pass: 2, warn: 1, fail: 0 }, checks: [] };
    saveDoctorLatest(report, root);
    expect(formatDoctorChat(root)).toMatch(/2 PASS \/ 1 WARN \/ 0 FAIL/);
  });

  it('shouldNotify on signature change or any FAIL', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-notify-'));
    const a = { summary: { pass: 1, warn: 0, fail: 0 }, checks: [{ status: 'PASS', name: 'x' }] };
    const b = { summary: { pass: 0, warn: 0, fail: 1 }, checks: [{ status: 'FAIL', name: 'y' }] };
    expect(shouldNotify(a, root)).toBe(true);
    saveDoctorLatest(a, root);
    fs.mkdirSync(path.join(root, '.runtime', 'doctor'), { recursive: true });
    fs.writeFileSync(path.join(root, '.runtime', 'doctor', 'notify-state.json'), JSON.stringify({ lastSignature: '1|0|0|' }));
    expect(shouldNotify(a, root)).toBe(false);
    expect(shouldNotify(b, root)).toBe(true);
  });

  it('runHydiDoctor aggregates mocked happy path', async () => {
    const now = new Date().toISOString();
    const fetch = mockFetch({
      '/health': async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          lease_held: true,
          allow_exec: false,
          last_cycle_at: now,
          cycles: 3,
        }),
      }),
      '/api/tags': async () => ({
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: 'qwen2.5:3b-instruct-q4_K_M' }] }),
      }),
      'heidi_state_snapshots': async () => ({
        ok: true,
        status: 200,
        headers: { get: (h) => (h === 'content-range' ? '0-0/5' : null) },
        json: async () => [{ captured_at: now }],
      }),
      'heidi_events': async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '0-0/10' },
        json: async () => [{ created_at: now }],
      }),
      'heidi_reflections': async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '0-0/0' },
        json: async () => [],
      }),
      job_leads: async () => ({
        ok: false,
        status: 404,
        headers: { get: () => null },
        text: async () => 'table does not exist',
        json: async () => null,
      }),
      ':9000/health': async () => ({ ok: false, status: 503, json: async () => null }),
      ':9001/health': async () => ({ ok: false, status: 503, json: async () => null }),
    });

    const scoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-scout-'));
    fs.writeFileSync(path.join(scoutDir, 'status.json'), JSON.stringify({ ranAt: now }));
    fs.writeFileSync(path.join(scoutDir, 'leads.json'), JSON.stringify({ leads: [{ id: '1' }] }));

    const report = await runHydiDoctor({
      env: {
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
        HEIDI_BIND_HOST: '127.0.0.1',
        HEIDI_AGENT_PORT: '3462',
        JOB_SCOUT_DIR: scoutDir,
        DOCTOR_PLATFORM: 'linux',
        HEIDI_ALLOW_EXEC: 'false',
      },
      fetch,
    });

    expect(report.summary.fail).toBeGreaterThan(0); // ports not listening in CI
    const safety = report.checks.find((c) => c.name.startsWith('Safety'));
    expect(safety.status).toBe('PASS');
    const agent = report.checks.find((c) => c.name.startsWith('Heidi agent'));
    expect(agent.status).toBe('PASS');
    const ollama = report.checks.find((c) => c.name.startsWith('Ollama'));
    expect(ollama.status).toBe('PASS');

    const table = formatDoctorTable(report);
    expect(table).toMatch(/HYDI DOCTOR/);
    expect(formatNotifyBody(report)).toMatch(/PASS/);
  });

  it('FAIL when HEIDI_ALLOW_EXEC=true in env', async () => {
    const fetch = mockFetch({
      '/health': async () => ({
        ok: false,
        status: 503,
        json: async () => null,
      }),
      '/api/tags': async () => ({ ok: false, status: 503, json: async () => null }),
    });
    const report = await runHydiDoctor({
      env: { HEIDI_ALLOW_EXEC: 'true', DOCTOR_PLATFORM: 'linux' },
      fetch,
    });
    const safety = report.checks.find((c) => c.name.startsWith('Safety'));
    expect(safety.status).toBe('FAIL');
  });
});