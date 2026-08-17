'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const localStore = require('../../lib/health/local-dashboard-store');

describe('HYDI health local-first store', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-health-'));
    process.env.HYDI_HEALTH_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.HYDI_HEALTH_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns default dashboard when no file exists', () => {
    const dash = localStore.getDashboard();
    expect(dash.current_status).toBe('OK');
    expect(dash.jobs_queued).toBe(0);
    expect(dash.escalation_level).toBe('OK');
    expect(dash.last_check).toBeDefined();
  });

  test('persists and re-reads dashboard', () => {
    localStore.setDashboard({
      jobs_queued: 3,
      jobs_failed: 1,
      events_last_hour: 42,
    });

    // Simulate restart by creating a fresh require
    delete require.cache[require.resolve('../../lib/health/local-dashboard-store')];
    const restarted = require('../../lib/health/local-dashboard-store');
    const dash = restarted.getDashboard();
    expect(dash.jobs_queued).toBe(3);
    expect(dash.jobs_failed).toBe(1);
    expect(dash.events_last_hour).toBe(42);
    expect(dash.current_status).toBe('OK');
  });

  test('records auto-heal and counts 24h window', () => {
    localStore.recordAutoHeal([
      { action: 'restart_worker', target: 'event_bus' },
      { action: 'clear_queue', target: 'queue-1' },
    ]);

    const dash = localStore.getDashboard();
    expect(dash.auto_heals_24h).toBe(2);
    expect(localStore.listRecentAutoHeals().length).toBe(1);
  });

  test('reports cloud unavailable correctly through api/health handler', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.HYDI_HEALTH_SOURCE = 'local';

    const handler = (await import('../../api/health.js')).default;

    const res = {
      _status: 200,
      _json: null,
      status(code) { this._status = code; return this; },
      json(body) { this._json = body; },
      setHeader() {},
      end() {},
    };

    const req = { method: 'GET' };

    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._json.status).toBe('healthy');
    expect(res._json.cloud.available).toBe(false);
    expect(res._json.cloud.source).toBe('local');
    expect(res._json.metrics.jobs_queued).toBe(0);
  });

  test('falls back to default local dashboard when no data dir is configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.HYDI_HEALTH_DATA_DIR;

    const handler = (await import('../../api/health.js')).default;

    const res = {
      _status: 200,
      _json: null,
      status(code) { this._status = code; return this; },
      json(body) { this._json = body; },
      setHeader() {},
      end() {},
    };

    const req = { method: 'GET' };
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._json.status).toBe('healthy');
    expect(res._json.cloud.available).toBe(false);
  });
});
