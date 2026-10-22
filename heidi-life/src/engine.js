// One "cycle" = refresh visits → sync sources → roll up recent days → insights → gate actions.
import { refreshVisits } from './places.js';
import { syncCalendars } from './sources/calendar.js';
import { syncStripe } from './sources/stripe.js';
import { syncUsage } from './sources/usage.js';
import { rollupDay, generateInsights } from './analyze.js';
import { propose } from './gate.js';
import { digest } from './llm.js';
import { audit } from './db.js';
import { localDay, addDays, DAY, HOUR } from './util.js';
import { writeReflection } from './calibrate.js';

export async function syncSources(db, cfg) {
  const result = {};
  for (const [name, fn] of [['calendar', syncCalendars], ['stripe', syncStripe], ['usage', syncUsage]]) {
    try { result[name] = await fn(db, cfg); }
    catch (e) { result[name] = `error: ${e.message}`; audit(db, 'source_error', { name, error: e.message }); }
  }
  return result;
}

export function rollupRecent(db, cfg, nowTs = Date.now()) {
  const today = localDay(nowTs, cfg.timezone);
  refreshVisits(db, cfg, nowTs - 3 * DAY);
  for (let i = 2; i >= 0; i--) rollupDay(db, cfg, addDays(today, -i));
  return today;
}

export async function runInsights(db, cfg, day, { withDigest = true } = {}) {
  const found = generateInsights(db, cfg, day);
  const results = [];
  for (const i of found) {
    const { lastInsertRowid, changes } = db.prepare(
      'INSERT OR IGNORE INTO insights (day, kind, focus, text, confidence, created) VALUES (?,?,?,?,?,?)'
    ).run(day, i.kind, i.focus, i.text, i.confidence, Date.now());
    if (!changes) continue;
    const gate = i.action ? propose(db, cfg, Number(lastInsertRowid), i.action) : null;
    results.push({ ...i, gate });
  }
  if (withDigest) {
    const row = db.prepare('SELECT json FROM daily WHERE day = ?').get(day);
    const d = await digest(cfg, row ? JSON.parse(row.json) : {}, found);
    audit(db, 'digest', { day, ...d });
  }
  return results;
}

export function purgeOld(db, cfg) {
  const cutoff = Date.now() - (cfg.retention?.rawPingDays ?? 90) * DAY;
  const { changes } = db.prepare('DELETE FROM pings WHERE ts < ?').run(cutoff);
  if (changes) audit(db, 'purge', { pings: changes });
}

// Scheduler: light work every 15 min, sources hourly, insights once each evening,
// and a persisted calibration self-review after 21:00 each Sunday (all local time).
export function startScheduler(db, cfg, log = console.log) {
  let lastSources = 0, lastInsightDay = null;
  const tick = async () => {
    try {
      const now = Date.now();
      const today = rollupRecent(db, cfg, now);
      if (now - lastSources > HOUR) { log('sources', await syncSources(db, cfg)); lastSources = now; purgeOld(db, cfg); }
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
      if (hour >= 21 && lastInsightDay !== today) {
        const r = await runInsights(db, cfg, today);
        lastInsightDay = today;
        log(`insights ${today}:`, r.map(x => `${x.kind}→${x.gate?.verdict ?? 'info'}`).join(', ') || 'none');
      }
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone, weekday: 'short' }).format(new Date(now));
      if (weekday === 'Sun' && hour >= 21) {
        const review = await writeReflection(db, cfg, now);
        if (review.written) log(`self-review ${today}:`, review.reflection.note);
      }
    } catch (e) { log('cycle error', e); audit(db, 'cycle_error', e.message); }
  };
  tick();
  return setInterval(tick, 15 * 60 * 1000);
}
