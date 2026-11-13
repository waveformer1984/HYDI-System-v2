'use strict';

const { parseTailscaleServeStatus, evaluateFrontDoor } = require('../../lib/observation/front-door');
const { buildFixList } = require('../../lib/observation/fix-list');

const GOOD_SERVE = `
https://heidi-pc.tailc50af2.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:3000
`;

describe('front-door watchdog', () => {
  it('parses a healthy 443 → :3000 mapping', () => {
    const p = parseTailscaleServeStatus(GOOD_SERVE);
    expect(p.mapped).toBe(true);
    expect(p.ok).toBe(true);
  });

  it('flags missing mapping as CRIT via fix-list', () => {
    const verdict = evaluateFrontDoor({ serveStatusText: 'no serve configured', healthProbe: { ok: false } });
    expect(verdict.ok).toBe(false);
    const list = buildFixList({
      frontDoor: { ok: false, detail: verdict.serve.detail, evidence: {} },
      now: Date.now(),
    });
    const item = list.items.find((i) => i.kind === 'front_door');
    expect(item).toBeTruthy();
    expect(item.level).toBe('CRIT');
    expect(item.proposedFix.command).toContain('serve-heidi-web.ps1');
  });

  it('stays silent when serve and health are good', () => {
    const verdict = evaluateFrontDoor({ serveStatusText: GOOD_SERVE, healthProbe: { ok: true, status: 200 } });
    expect(verdict.ok).toBe(true);
    const list = buildFixList({ frontDoor: { ok: true }, now: Date.now() });
    expect(list.items.some((i) => i.kind === 'front_door')).toBe(false);
  });
});
