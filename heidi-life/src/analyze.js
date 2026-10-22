// Daily rollups + rule-based insights. Every insight carries a confidence; some propose an action
// that then has to clear the triple gate (gate.js) before anything happens.
import { haversineM, localDay, localHour, dayStart, addDays, overlapMs, MIN, HOUR, DAY, fmtH, fmtUsd } from './util.js';
import { unnamedHotspots } from './places.js';

const home = cfg => (cfg.places || []).find(p => p.isHome);

// ---------- daily rollup ----------
export function rollupDay(db, cfg, day) {
  const tz = cfg.timezone;
  const s = dayStart(day, tz), e = dayStart(addDays(day, 1), tz);
  const visits = db.prepare('SELECT * FROM visits WHERE end > ? AND start < ? ORDER BY start').all(s, e);
  const events = db.prepare('SELECT * FROM cal_events WHERE end > ? AND start < ? ORDER BY start').all(s, e);
  const pings = db.prepare('SELECT * FROM pings WHERE ts >= ? AND ts < ? ORDER BY ts').all(s, e);
  const H = home(cfg);

  const placeMinutes = {}, divisionMinutes = {};
  let homeMin = 0;
  for (const v of visits) {
    const m = overlapMs(v.start, v.end, s, e) / MIN;
    const name = v.place || 'Unnamed spot';
    placeMinutes[name] = (placeMinutes[name] || 0) + m;
    if (H && v.place === H.name) homeMin += m;
    if (v.division) divisionMinutes[v.division] = (divisionMinutes[v.division] || 0) + m;
  }
  let meetingMin = 0;
  for (const ev of events) {
    const m = overlapMs(ev.start, ev.end, s, e) / MIN;
    meetingMin += m;
    if (!ev.division) continue;
    // don't double count time already seen physically at that division's place
    const dup = visits.filter(v => v.division === ev.division)
      .reduce((a, v) => a + overlapMs(v.start, v.end, ev.start, ev.end), 0) / MIN;
    divisionMinutes[ev.division] = (divisionMinutes[ev.division] || 0) + Math.max(0, m - dup);
  }

  // departures from home and stops elsewhere
  let departures = 0, stops = 0;
  visits.forEach((v, i) => {
    if (v.start >= s && !(H && v.place === H.name)) stops++;
    if (H && v.place === H.name && v.end < e && visits[i + 1]) departures++;
  });

  // distance (jitter-filtered)
  let distM = 0;
  const good = pings.filter(p => p.acc == null || p.acc <= 100);
  for (let i = 1; i < good.length; i++) {
    const d = haversineM(good[i - 1], good[i]);
    if (d > 40 && good[i].ts - good[i - 1].ts < HOUR) distM += d;
  }

  const sleep = estimateSleep(db, cfg, day);

  const apps = db.prepare('SELECT pkg, minutes FROM usage WHERE day = ? ORDER BY minutes DESC').all(day);
  const social = new Set(cfg.sources?.adbUsage?.socialPackages || []);
  const screenMin = apps.reduce((a, r) => a + r.minutes, 0);
  const socialMin = apps.filter(r => social.has(r.pkg)).reduce((a, r) => a + r.minutes, 0);

  const rev = db.prepare('SELECT division, SUM(amount_cents) AS c FROM revenue WHERE ts >= ? AND ts < ? GROUP BY division').all(s, e);
  const revenueByDivision = Object.fromEntries(rev.map(r => [r.division || 'Unattributed', r.c]));

  // calendar fragmentation: short gaps between back-to-back daytime events
  let shortGaps = 0;
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].start - events[i - 1].end;
    if (gap > 0 && gap < HOUR) shortGaps++;
  }

  const r = {
    day, pings: pings.length,
    placeMinutes: round(placeMinutes), divisionMinutes: round(divisionMinutes),
    homeMinutes: Math.round(homeMin), departures, stops,
    distanceKm: +(distM / 1000).toFixed(1),
    sleep, screenMinutes: screenMin || null, socialMinutes: apps.length ? socialMin : null,
    topApps: apps.slice(0, 5),
    meetings: events.length, meetingMinutes: Math.round(meetingMin), shortGaps,
    revenueByDivision, revenueCents: rev.reduce((a, r) => a + r.c, 0)
  };
  db.prepare('INSERT OR REPLACE INTO daily (day, json, updated) VALUES (?,?,?)').run(day, JSON.stringify(r), Date.now());
  return r;
}

const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).sort((a, b) => b[1] - a[1]));

// Sleep for the night *ending* on `day`: longest stretch 20:00 prev → 12:00 at home, phone charging,
// no gap over 90 min. It's an estimate and is labelled as one everywhere.
export function estimateSleep(db, cfg, day) {
  const tz = cfg.timezone, H = home(cfg);
  if (!H) return null;
  const from = dayStart(addDays(day, -1), tz) + 20 * HOUR, to = dayStart(day, tz) + 12 * HOUR;
  const pings = db.prepare('SELECT * FROM pings WHERE ts >= ? AND ts < ? ORDER BY ts').all(from, to);
  let best = null, run = null;
  for (const p of pings) {
    const atHome = p.lat != null && haversineM(p, H) <= (H.radius || 150) + (p.acc || 0);
    if (atHome && p.charging === 1 && (!run || p.ts - run.end <= 90 * MIN)) {
      run = run ? { ...run, end: p.ts } : { start: p.ts, end: p.ts };
    } else {
      run = atHome && p.charging === 1 ? { start: p.ts, end: p.ts } : null;
    }
    if (run && (!best || run.end - run.start > best.end - best.start)) best = { ...run };
  }
  if (!best || best.end - best.start < 3 * HOUR) return null;
  return {
    minutes: Math.round((best.end - best.start) / MIN),
    bedHour: +localHour(best.start, tz).toFixed(2),
    wakeHour: +localHour(best.end, tz).toFixed(2),
    estimated: true
  };
}

// ---------- insights ----------
const COOLDOWN_DAYS = { revenue_time: 7, sleep_short: 3, bedtime_drift: 4, errands: 7, social_screen: 3, low_movement: 3, fragmentation: 7, name_places: 14 };

function recentlyFired(db, kind, day) {
  const since = addDays(day, -(COOLDOWN_DAYS[kind] ?? 3) + 1);
  return !!db.prepare('SELECT 1 FROM insights WHERE kind = ? AND day >= ? AND day < ?').get(kind, since, day);
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sd = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
const hhmm = h => { const hh = Math.floor(((h % 24) + 24) % 24), mm = Math.round((h - Math.floor(h)) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };

export function generateInsights(db, cfg, day) {
  const tz = cfg.timezone;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(day, -i);
    const row = db.prepare('SELECT json FROM daily WHERE day = ?').get(d);
    if (row) days.push(JSON.parse(row.json));
  }
  const last7 = days.filter(d => d.day > addDays(day, -7));
  const withData = last7.filter(d => d.pings > 20);
  const out = [];
  const tomorrow = addDays(day, 1);
  const claimed = []; // slots taken by earlier proposals in this same run

  // 1. Revenue vs time per division (Time & focus + Revenue)
  const hrs = {}, rev = {};
  for (const d of days) {
    for (const [k, m] of Object.entries(d.divisionMinutes)) hrs[k] = (hrs[k] || 0) + m;
    for (const [k, c] of Object.entries(d.revenueByDivision)) rev[k] = (rev[k] || 0) + c;
  }
  const ranked = Object.keys({ ...hrs, ...rev }).filter(k => k !== 'Unattributed')
    .map(k => ({ div: k, min: hrs[k] || 0, cents: rev[k] || 0, perHour: (rev[k] || 0) / Math.max(1, (hrs[k] || 0) / 60) }));
  const sink = ranked.filter(r => r.min >= 240 && r.cents === 0).sort((a, b) => b.min - a.min)[0];
  const earner = ranked.filter(r => r.cents > 0 && r.min >= 60).sort((a, b) => b.perHour - a.perHour)[0];
  if ((sink || earner) && days.length >= 7) {
    const parts = [];
    if (earner) parts.push(`${earner.div} is your best return: ${fmtUsd(earner.cents)} over 14 days on ${fmtH(earner.min)} (≈${fmtUsd(earner.perHour)}/h).`);
    if (sink) parts.push(`${sink.div} took ${fmtH(sink.min)} with no recorded revenue — worth deciding if that's R&D on purpose.`);
    const conf = Math.min(0.92, 0.6 + 0.03 * days.length);
    const slot = earner && findFreeSlot(db, cfg, tomorrow, 90, claimed);
    out.push({
      kind: 'revenue_time', focus: 'Revenue', text: parts.join(' '), confidence: conf,
      action: slot && { type: 'focus_block', confidence: conf, payload: { title: `Focus: ${earner.div}`, start: slot.start, end: slot.end } }
    });
  }

  // 2. Sleep length and consistency (Health & routine)
  const nights = last7.map(d => d.sleep).filter(Boolean);
  if (nights.length >= 4) {
    const avg = nights.reduce((a, n) => a + n.minutes, 0) / nights.length;
    const beds = nights.map(n => n.bedHour < 12 ? n.bedHour + 24 : n.bedHour);
    const medBed = median(beds);
    const conf = Math.min(0.9, 0.62 + 0.05 * nights.length);
    if (avg < 390) {
      const remind = Math.min(medBed - 1.5, 21.5); // stay outside quiet hours
      out.push({
        kind: 'sleep_short', focus: 'Health & routine', confidence: conf,
        text: `Estimated sleep is averaging ${fmtH(avg)} over ${nights.length} nights (phone-on-charger at home). Typical lights-out ≈ ${hhmm(medBed)}.`,
        action: { type: 'notify', confidence: conf, payload: { title: 'Wind down', body: `Aim for lights-out by ${hhmm(medBed - 0.5)} tonight.`, at: dayStart(day, tz) + remind * HOUR } }
      });
    }
    if (sd(beds) > 1.25) {
      out.push({
        kind: 'bedtime_drift', focus: 'Health & routine', confidence: conf - 0.05,
        text: `Bedtime is swinging by about ±${sd(beds).toFixed(1)}h night to night. A steadier window tends to help focus more than extra hours.`,
        action: { type: 'journal', confidence: 0.95, payload: { note: `Bedtime SD ${sd(beds).toFixed(2)}h; median ${hhmm(medBed)}` } }
      });
    }
  }

  // 3. Errand batching (Commute & errands)
  const busyDays = withData.filter(d => d.departures >= 3);
  if (busyDays.length >= 2) {
    const conf = Math.min(0.88, 0.6 + 0.08 * busyDays.length);
    const driveDays = busyDays.map(d => new Date(dayStart(d.day, tz) + 12 * HOUR).toLocaleDateString('en-US', { weekday: 'short', timeZone: tz }));
    out.push({
      kind: 'errands', focus: 'Commute & errands', confidence: conf,
      text: `${busyDays.length} of the last 7 days had 3+ separate trips out from home (${driveDays.join(', ')}). Batching into one loop could free up an hour-plus each time.`,
      action: { type: 'notify', confidence: conf, payload: { title: 'Batch today’s runs', body: 'Planning to go out more than once? Stack the stops into one loop.', at: dayStart(tomorrow, tz) + 9 * HOUR } }
    });
  }

  // 4. Social screen time (Time & focus)
  const soc = last7.map(d => d.socialMinutes).filter(v => v != null);
  if (soc.length >= 3) {
    const avg = soc.reduce((a, b) => a + b, 0) / soc.length;
    if (avg > 90) out.push({
      kind: 'social_screen', focus: 'Time & focus', confidence: 0.8,
      text: `Social/video apps are averaging ${fmtH(avg)} a day on the phone this week.`,
      action: { type: 'notify', confidence: 0.8, payload: { title: 'Phone check', body: `Social is at ~${Math.round(avg)} min/day this week.`, at: dayStart(tomorrow, tz) + 13 * HOUR } }
    });
  }

  // 5. Low-movement days (Health & routine)
  const still = withData.filter(d => d.distanceKm < 1 && d.homeMinutes > 20 * 60);
  if (still.length >= 3) {
    const conf = Math.min(0.9, 0.7 + 0.05 * still.length);
    out.push({
      kind: 'low_movement', focus: 'Health & routine', confidence: conf,
      text: `${still.length} days this week you stayed home almost all day and moved under 1 km.`,
      action: { type: 'notify', confidence: conf, payload: { title: 'Get outside', body: '20-minute walk before the afternoon block?', at: dayStart(tomorrow, tz) + 16 * HOUR } }
    });
  }

  // 6. Calendar fragmentation (Time & focus)
  const frag = last7.reduce((a, d) => a + d.shortGaps, 0);
  if (frag >= 6) {
    const slot = findFreeSlot(db, cfg, tomorrow, 120, claimed);
    out.push({
      kind: 'fragmentation', focus: 'Time & focus', confidence: 0.75,
      text: `${frag} short (<1h) gaps between calendar items this week — time that rarely turns into real work.`,
      action: slot && { type: 'focus_block', confidence: 0.75, payload: { title: 'Focus: deep work', start: slot.start, end: slot.end } }
    });
  }

  // 7. Places worth naming (data quality → better everything else)
  const spots = unnamedHotspots(db, cfg, dayStart(addDays(day, -13), tz));
  if (spots.length) out.push({
    kind: 'name_places', focus: 'Time & focus', confidence: 0.95,
    text: `${spots.length} unnamed place${spots.length > 1 ? 's' : ''} you keep returning to. Name them in config.json so time can be attributed to a division: ` +
      spots.map(s => `(${s.lat}, ${s.lon}) ${fmtH(s.minutes)}`).join('; '),
    action: { type: 'journal', confidence: 0.95, payload: { note: 'unnamed hotspots', spots } }
  });

  return out.filter(i => !recentlyFired(db, i.kind, day));
}

// First open slot on `day` within bounds, preferring mornings, avoiding calendar events and existing blocks.
export function findFreeSlot(db, cfg, day, minutes, claimed = []) {
  const tz = cfg.timezone, b = cfg.gate.bounds.focus_block;
  const base = dayStart(day, tz);
  const busy = [
    ...db.prepare('SELECT start, end FROM cal_events WHERE end > ? AND start < ?').all(base, base + DAY),
    ...db.prepare('SELECT start, end FROM focus_blocks WHERE end > ? AND start < ?').all(base, base + DAY),
    // proposals still waiting on review hold their slot too
    ...db.prepare("SELECT payload FROM actions WHERE type = 'focus_block' AND status IN ('pending','approved')").all()
      .map(r => JSON.parse(r.payload)).filter(p => p.end > base && p.start < base + DAY),
    ...claimed
  ];
  const len = Math.min(minutes, b.maxMinutes) * MIN;
  for (const h of [9, 10, 8, 13, 14, 15, 11, 16, 17]) {
    if (h < b.earliestHour || h * HOUR + len > b.latestHour * HOUR) continue;
    const st = base + h * HOUR, en = st + len;
    if (!busy.some(x => overlapMs(x.start, x.end, st, en) > 0)) { claimed.push({ start: st, end: en }); return { start: st, end: en }; }
  }
  return null;
}
