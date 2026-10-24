'use strict';

const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'frank-funnel.ps1'), 'utf8');

describe('Frank Galactic Bytes Funnel script', () => {
  it('exposes only heidi-web on HTTPS 443 and prints the public URL', () => {
    expect(script).toContain('tailscale funnel --bg --https=443 $LocalOrigin');
    expect(script).toContain("https://heidi-pc.tailc50af2.ts.net");
    expect(script).toContain('http://127.0.0.1:3000');
  });

  it('supports the requested --off flag without resetting other serves', () => {
    expect(script).toContain("$args -contains '--off'");
    expect(script).toContain('tailscale funnel --https=443 off');
    expect(script).not.toContain('tailscale funnel reset');
  });

  it('does not install an automatic task or PM2 process', () => {
    expect(script).not.toMatch(/Register-ScheduledTask|New-ScheduledTask|pm2\s+start/i);
  });
});
