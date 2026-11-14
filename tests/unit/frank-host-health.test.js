'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildFrankHostHealth,
  applyFrankHostToConnectionState,
  DISK_C_MIN_GB,
  MEM_FREE_MIN_GB,
} = require('../../lib/heidi-mobile/frank-host-health');

const NOW = Date.parse('2026-11-14T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function repo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-host-'));
  for (const [rel, value] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}

function freshObs(overrides = {}) {
  return {
    schema: 'observatory-sample/1',
    ts: iso(45 * 1000),
    host: {
      mem_total_mb: 16384,
      mem_avail_mb: 4096,
      pagefile_alloc_mb: 16384,
      pagefile_used_mb: 2000,
      pagefile_peak_mb: 4000,
      disks: [{ drive: 'C', total_gb: 476, free_gb: 40, health: 'Healthy' }],
    },
    probes: { kong_54321: true, db_tcp_54322: true },
    pm2: { available: true, processes: [] },
    docker: { available: true, containers: [] },
    findings_active: [],
    ...overrides,
  };
}

describe('buildFrankHostHealth', () => {
  it('reports healthy when vitals and probes are within thresholds', () => {
    const root = repo({ '.observatory/current.json': freshObs() });
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('healthy');
    expect(h.stale).toBe(false);
    expect(h.metrics.disk_c_free_gb).toBe(40);
    expect(h.metrics.mem_free_gb).toBe(4);
    expect(h.metrics.pagefile_alloc_mb).toBe(16384);
    expect(h.metrics.kong).toBe('healthy');
    expect(h.metrics.db).toBe('healthy');
  });

  it('marks stale when observatory sample is missing', () => {
    const root = repo();
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('stale');
    expect(h.stale).toBe(true);
    expect(h.metrics.kong).toBe('stale');
    expect(h.reasons[0]).toMatch(/no sample/i);
  });

  it('marks stale when observatory is too old', () => {
    const root = repo({ '.observatory/current.json': freshObs({ ts: iso(10 * 60 * 1000) }) });
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('stale');
    expect(h.metrics.kong).toBe('stale');
  });

  it('degrades when C: free is under threshold', () => {
    const root = repo({
      '.observatory/current.json': freshObs({
        host: {
          mem_avail_mb: 4096,
          pagefile_alloc_mb: 8192,
          disks: [{ drive: 'C', total_gb: 476, free_gb: DISK_C_MIN_GB - 0.5 }],
        },
      }),
    });
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('degraded');
    expect(h.reasons.some((r) => r.includes('C:'))).toBe(true);
  });

  it('degrades when free RAM is under threshold', () => {
    const root = repo({
      '.observatory/current.json': freshObs({
        host: {
          mem_avail_mb: Math.floor(MEM_FREE_MIN_GB * 1024) - 100,
          pagefile_alloc_mb: 8192,
          disks: [{ drive: 'C', total_gb: 476, free_gb: 40 }],
        },
      }),
    });
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('degraded');
    expect(h.reasons.some((r) => r.includes('RAM'))).toBe(true);
  });

  it('degrades when kong probe failed', () => {
    const root = repo({
      '.observatory/current.json': freshObs({ probes: { kong_54321: false, db_tcp_54322: true } }),
    });
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('degraded');
    expect(h.metrics.kong).toBe('unhealthy');
    expect(h.reasons.some((r) => /kong/i.test(r))).toBe(true);
  });

  it('degrades when db probe failed', () => {
    const root = repo({
      '.observatory/current.json': freshObs({ probes: { kong_54321: true, db_tcp_54322: false } }),
    });
    const h = buildFrankHostHealth({ root, now: NOW });
    expect(h.state).toBe('degraded');
    expect(h.metrics.db).toBe('unhealthy');
  });
});

describe('applyFrankHostToConnectionState', () => {
  it('degrades online when Frank host is degraded', () => {
    expect(applyFrankHostToConnectionState('online', { state: 'degraded' })).toBe('degraded');
  });
  it('does not change offline', () => {
    expect(applyFrankHostToConnectionState('offline', { state: 'degraded' })).toBe('offline');
  });
});