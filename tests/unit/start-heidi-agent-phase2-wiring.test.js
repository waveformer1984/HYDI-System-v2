'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('start-heidi-everything.ps1 — Phase 2 agent wiring', () => {
  const ps1 = fs.readFileSync(path.join(ROOT, 'start-heidi-everything.ps1'), 'utf8');

  it('exposes -AgentOnly and pm2 --only heidi-agent', () => {
    expect(ps1).toMatch(/\[switch\]\$AgentOnly/);
    expect(ps1).toMatch(/--only heidi-agent/);
  });

  it('probes heidi-agent health on :3462', () => {
    expect(ps1).toMatch(/\/health/);
    expect(ps1).toMatch(/HeidiAgentPort\s*=\s*3462/);
    expect(ps1).toMatch(/Heidi Agent component/);
    expect(ps1).toMatch(/ProtoForge_Ecosystem\\logs\\heidi-agent\.log/);
    expect(ps1).toMatch(/boot summary/i);
  });

  it('does not set HEIDI_ALLOW_EXEC=true in the script', () => {
    expect(ps1).not.toMatch(/HEIDI_ALLOW_EXEC\s*=\s*'true'/);
    expect(ps1).not.toMatch(/HEIDI_ALLOW_EXEC\s*=\s*true/);
  });
});