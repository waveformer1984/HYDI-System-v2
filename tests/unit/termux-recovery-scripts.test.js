'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('Termux recovery scripts', () => {
  const scripts = [
    'termux/hydi-storage-audit.sh',
    'termux/hydi-storage-recover.sh',
    'termux/hydi-recovery.sh',
    'termux/phone-audit-phase0.sh',
  ];

  for (const rel of scripts) {
    it(`${rel} exists and is non-empty`, () => {
      const p = path.join(ROOT, rel);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf8').length).toBeGreaterThan(100);
    });
  }

  it('storage recover refuses unrestricted rm -rf home', () => {
    const body = fs.readFileSync(path.join(ROOT, 'termux/hydi-storage-recover.sh'), 'utf8');
    expect(body).not.toMatch(/rm\s+-rf\s+["']?\$HOME["']?\s/);
    expect(body).toMatch(/\.ollama/);
    expect(body).toMatch(/heidi_memory\.db/);
    expect(body).toMatch(/--dry-run/);
  });

  it('phone-audit-phase0 avoids heredocs and covers Phase 0 ports', () => {
    const body = fs.readFileSync(path.join(ROOT, 'termux/phone-audit-phase0.sh'), 'utf8');
    expect(body).not.toMatch(/<<-?\s*['"]?EOF/);
    expect(body).toMatch(/8080/);
    expect(body).toMatch(/settings_enable_monitor_phantom_procs/);
    expect(body).toMatch(/FRANK_IP/);
  });

  it('hydi-doctor probes api/health on listening ports', () => {
    const body = fs.readFileSync(path.join(ROOT, 'scripts/hydi-doctor.sh'), 'utf8');
    expect(body).toMatch(/\/api\/health/);
    expect(body).toMatch(/11434\/api\/tags/);
  });
});
