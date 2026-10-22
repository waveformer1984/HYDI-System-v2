// Google Calendar via its free "Secret address in iCal format" — no OAuth, no API cost.
// Expands simple DAILY/WEEKLY recurrences inside a rolling window.
import { localToUtc, matchDivision, DAY, MIN } from '../util.js';

function unfold(text) { return text.replace(/\r?\n[ \t]/g, ''); }

function parseDate(value, params, tz) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h == null) return { ts: localToUtc(+y, +mo, +d, 0, 0, tz), allDay: true };
  if (z) return { ts: Date.UTC(+y, +mo - 1, +d, +h, +mi), allDay: false };
  // TZID or floating: treat as the configured zone (correct for a San Antonio calendar).
  return { ts: localToUtc(+y, +mo, +d, +h, +mi, tz), allDay: false };
}

export function parseIcs(text, tz) {
  const events = [];
  let cur = null;
  for (const line of unfold(text).split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':'); if (idx < 0) continue;
    const [name, ...params] = line.slice(0, idx).split(';');
    const value = line.slice(idx + 1);
    if (name === 'UID') cur.uid = value;
    else if (name === 'SUMMARY') cur.title = value.replace(/\\,/g, ',').replace(/\\n/g, ' ');
    else if (name === 'DTSTART') { const p = parseDate(value, params, tz); if (p) { cur.start = p.ts; cur.allDay = p.allDay; } }
    else if (name === 'DTEND') { const p = parseDate(value, params, tz); if (p) cur.end = p.ts; }
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map(kv => kv.split('=')));
    else if (name === 'STATUS') cur.status = value;
    else if (name === 'TRANSP') cur.transp = value;
  }
  return events.filter(e => e.status !== 'CANCELLED' && !e.allDay)
    .map(e => ({ ...e, end: e.end ?? e.start + 60 * MIN }));
}

const BYDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function expand(events, fromTs, toTs, tz = 'UTC') {
  const wd = t => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(t)));
  const out = [];
  for (const e of events) {
    const dur = e.end - e.start;
    if (!e.rrule) { if (e.end >= fromTs && e.start <= toTs) out.push(e); continue; }
    const freq = e.rrule.FREQ, interval = +(e.rrule.INTERVAL || 1);
    if (freq !== 'DAILY' && freq !== 'WEEKLY') { if (e.end >= fromTs && e.start <= toTs) out.push(e); continue; }
    const until = e.rrule.UNTIL ? parseDate(e.rrule.UNTIL, [], 'UTC')?.ts ?? Infinity : Infinity;
    const maxCount = e.rrule.COUNT ? +e.rrule.COUNT : Infinity;
    const days = e.rrule.BYDAY ? e.rrule.BYDAY.split(',').map(d => BYDAY[d.slice(-2)]) : null;
    let n = 0;
    for (let t = e.start, i = 0; t <= Math.min(toTs, until) && n < maxCount && i < 2000; t += DAY, i++) {
      const weekIdx = Math.floor(i / 7);
      const ok = freq === 'DAILY' ? i % interval === 0
        : weekIdx % interval === 0 && (days ? days.includes(wd(t)) : i % 7 === 0);
      if (!ok) continue;
      n++;
      if (t + dur >= fromTs) out.push({ ...e, uid: `${e.uid}@${t}`, start: t, end: t + dur });
    }
  }
  return out;
}

export async function syncCalendars(db, cfg) {
  const urls = cfg.sources?.calendarIcsUrls || [];
  let count = 0;
  const from = Date.now() - 30 * DAY, to = Date.now() + 14 * DAY;
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`calendar ${res.status}`);
    const events = expand(parseIcs(await res.text(), cfg.timezone), from, to, cfg.timezone);
    const up = db.prepare('INSERT OR REPLACE INTO cal_events (uid, start, end, title, division, source) VALUES (?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (const e of events) {
      if (e.transp === 'TRANSPARENT') continue;
      up.run(e.uid, e.start, e.end, e.title || '(busy)', matchDivision(e.title, cfg.divisionKeywords), 'ics');
      count++;
    }
    db.exec('COMMIT');
  }
  return count;
}
