/**
 * Kill-switch durability — .hydi-operational/kill-switch.json.
 * A daemon restart must not silently disarm an operator halt.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readKillSwitch, writeKillSwitch, killSwitchPath } from '../../lib/heidi/KillSwitchState';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
}

describe('KillSwitchState', () => {
  it('missing file means switch off (null), never a fabricated ON', () => {
    expect(readKillSwitch(tmpDir())).toBeNull();
  });

  it('ON survives a "restart" (fresh read of the durable file)', () => {
    const dir = tmpDir();
    writeKillSwitch({ active: true, reason: 'operator halt: investigate anomaly', setAt: new Date().toISOString(), setBy: 'heidi-daemon' }, dir);
    const after = readKillSwitch(dir); // simulated fresh process
    expect(after?.active).toBe(true);
    expect(after?.reason).toContain('operator halt');
  });

  it('explicit OFF persists as off and is distinguishable from absent', () => {
    const dir = tmpDir();
    writeKillSwitch({ active: false, reason: null, setAt: new Date().toISOString(), setBy: 'heidi-daemon' }, dir);
    const s = readKillSwitch(dir);
    expect(s?.active).toBe(false);
  });

  it('corrupt file degrades to null rather than throwing', () => {
    const dir = tmpDir();
    fs.writeFileSync(killSwitchPath(dir), '{not json');
    expect(readKillSwitch(dir)).toBeNull();
  });
});
