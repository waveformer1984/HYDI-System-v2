// Phone screen time per app, pulled from Frank over ADB (USB or Wireless debugging).
// Termux itself can't read usage stats — Android reserves that for ADB/system apps.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localDay } from '../util.js';

const run = promisify(execFile);

function toMinutes(s) {
  const parts = s.split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return secs / 60;
}

export function parseUsagestats(text) {
  const start = text.indexOf('In-memory daily stats');
  if (start < 0) return {};
  const endIdx = text.indexOf('In-memory weekly stats', start);
  const block = text.slice(start, endIdx > 0 ? endIdx : undefined);
  const out = {};
  for (const m of block.matchAll(/package=(\S+)\s+totalTimeUsed="([\d:]+)"/g)) {
    const mins = toMinutes(m[2]);
    if (mins >= 1) out[m[1]] = Math.max(out[m[1]] || 0, mins);
  }
  return out;
}

export async function syncUsage(db, cfg) {
  const u = cfg.sources?.adbUsage;
  if (!u?.enabled) return 0;
  const { stdout } = await run(u.adbPath || 'adb', ['shell', 'dumpsys', 'usagestats'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  const stats = parseUsagestats(stdout);
  const day = localDay(Date.now(), cfg.timezone);
  const up = db.prepare('INSERT OR REPLACE INTO usage (day, pkg, minutes) VALUES (?,?,?)');
  for (const [pkg, mins] of Object.entries(stats)) up.run(day, pkg, Math.round(mins));
  return Object.keys(stats).length;
}
