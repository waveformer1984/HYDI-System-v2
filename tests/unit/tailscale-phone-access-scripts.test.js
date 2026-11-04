'use strict';

const fs = require('fs');
const path = require('path');

describe('tailscale phone access scripts', () => {
  it('diagnose script probes /api/ping before /api/health (ping-first triage)', () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, '../../scripts/tailscale/diagnose-phone-access.ps1'),
      'utf8',
    );
    const pingIdx = ps1.indexOf('/api/ping');
    const healthIdx = ps1.indexOf('/api/health');
    expect(pingIdx).toBeGreaterThan(-1);
    expect(healthIdx).toBeGreaterThan(pingIdx);
  });

  it('serve-heidi-web script documents ping-first local probe', () => {
    const ps1 = fs.readFileSync(
      path.join(__dirname, '../../scripts/tailscale/serve-heidi-web.ps1'),
      'utf8',
    );
    expect(ps1).toMatch(/api\/ping.*api\/health/s);
  });
});
