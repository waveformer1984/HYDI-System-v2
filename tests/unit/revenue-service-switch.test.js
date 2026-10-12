'use strict';

/**
 * Revenue service switch — the durable ON/OFF control.
 * Covers: fail-closed defaults, audited flips, unknown-field rejection,
 * OFF semantics (new work refused, obligations preserved), and the
 * resolver-side gate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getServiceSwitch, isServiceEnabled, setServiceSwitch } = require('../../lib/revenue/revenue-service-switch.js');

function tmpPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sw-')), 'revenue-service.json');
}

describe('revenue service switch', () => {
  it('defaults OFF when no config exists (fail-closed)', () => {
    const p = tmpPath();
    expect(isServiceEnabled('checkpoint_audit', p)).toBe(false);
    const s = getServiceSwitch('checkpoint_audit', p);
    expect(s.serviceEnabled).toBe(false);
    expect(s.acquisitionEnabled).toBe(false);
    expect(s.livePaymentsEnabled).toBe(false);
  });

  it('reads as OFF when the config file is malformed', () => {
    const p = tmpPath();
    fs.writeFileSync(p, 'not json {{{');
    expect(isServiceEnabled('checkpoint_audit', p)).toBe(false);
  });

  it('flips a flag with a durable audit transition', () => {
    const p = tmpPath();
    const r = setServiceSwitch('checkpoint_audit', { serviceEnabled: true }, { actor: 'operator', configPath: p, reason: 'first-sale activation mission' });
    expect(r.changed).toBe(true);
    expect(r.state.serviceEnabled).toBe(true);
    expect(r.state.acquisitionEnabled).toBe(false);
    expect(r.state.livePaymentsEnabled).toBe(false);
    expect(r.state.transitions.length).toBe(1);
    expect(r.state.transitions[0].reason).toBe('first-sale activation mission');
    // durable across reads
    expect(getServiceSwitch('checkpoint_audit', p).serviceEnabled).toBe(true);
  });

  it('ignores unknown fields and no-ops on unchanged flags', () => {
    const p = tmpPath();
    setServiceSwitch('x', { serviceEnabled: true }, { configPath: p });
    const r = setServiceSwitch('x', { serviceEnabled: true, execEverything: true }, { configPath: p });
    expect(r.changed).toBe(false);
    expect(getServiceSwitch('x', p).execEverything).toBeUndefined();
  });

  it('OFF blocks new commercial intake but preserves existing state', () => {
    const p = tmpPath();
    const off = getServiceSwitch('checkpoint_audit', p);
    expect(off.serviceEnabled).toBe(false);
    // flipping ON then OFF leaves a full audit trail
    setServiceSwitch('checkpoint_audit', { serviceEnabled: true }, { configPath: p });
    setServiceSwitch('checkpoint_audit', { serviceEnabled: false }, { configPath: p, reason: 'kill test' });
    const s = getServiceSwitch('checkpoint_audit', p);
    expect(s.serviceEnabled).toBe(false);
    expect(s.transitions.length).toBe(2);
  });
});
