/**
 * Durable kill-switch state for the Heidi cognitive loop.
 *
 * killSwitchActive was process-memory only: a daemon restart silently
 * disarmed an operator-set halt. This module is the single authoritative
 * store — CognitiveCore writes on every transition and reads on start(),
 * so 'kill switch ON → restart → still ON' holds.
 *
 * Same local-file pattern as .hydi-operational/recovery-throttle.json:
 * synchronous atomic-ish write (tmp + rename), read-only on boot.
 * A missing/corrupt file means "switch off" — never fail closed on
 * startup reading, but an explicit ON survives every restart.
 */
import fs from 'fs';
import path from 'path';

export interface KillSwitchState {
  active: boolean;
  reason: string | null;
  setAt: string;
  setBy: string;
}

const DEFAULT_DIR = path.join(process.cwd(), '.hydi-operational');
const FILE_NAME = 'kill-switch.json';

export function killSwitchPath(dir = DEFAULT_DIR): string {
  return path.join(dir, FILE_NAME);
}

export function readKillSwitch(dir = DEFAULT_DIR): KillSwitchState | null {
  try {
    const p = killSwitchPath(dir);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    return {
      active: raw.active === true,
      reason: typeof raw.reason === 'string' ? raw.reason : null,
      setAt: typeof raw.setAt === 'string' ? raw.setAt : '',
      setBy: typeof raw.setBy === 'string' ? raw.setBy : 'unknown',
    };
  } catch {
    return null;
  }
}

export function writeKillSwitch(
  state: KillSwitchState,
  dir = DEFAULT_DIR,
): void {
  fs.mkdirSync(dir, { recursive: true });
  const p = killSwitchPath(dir);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, p);
}
