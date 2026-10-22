// Turns raw GPS pings into "visits" (stays of 10+ minutes) and names them from config.places.
import { haversineM, MIN, HOUR } from './util.js';

const STAY_RADIUS_M = 150;
const MIN_STAY_MS = 10 * MIN;
const MAX_GAP_MS = 2 * HOUR;     // a stay survives missing pings up to this long
const MAX_ACC_M = 250;

export function nameFor(pt, places) {
  let best = null;
  for (const p of places || []) {
    const d = haversineM(pt, p);
    if (d <= (p.radius || 150) && (!best || d < best.d)) best = { ...p, d };
  }
  return best;
}

export function detectVisits(pings, places) {
  const pts = pings.filter(p => p.lat != null && (p.acc == null || p.acc <= MAX_ACC_M));
  const visits = [];
  let cur = null;
  const close = () => {
    if (cur && cur.end - cur.start >= MIN_STAY_MS) {
      const named = nameFor(cur, places);
      visits.push({
        start: cur.start, end: cur.end, lat: cur.lat, lon: cur.lon,
        place: named?.name ?? null, division: named?.division ?? null, isHome: !!named?.isHome
      });
    }
    cur = null;
  };
  for (const p of pts) {
    if (cur && haversineM(cur, p) <= STAY_RADIUS_M && p.ts - cur.end <= MAX_GAP_MS) {
      cur.n++;
      cur.lat += (p.lat - cur.lat) / cur.n;
      cur.lon += (p.lon - cur.lon) / cur.n;
      cur.end = p.ts;
    } else {
      close();
      cur = { start: p.ts, end: p.ts, lat: p.lat, lon: p.lon, n: 1 };
    }
  }
  close();
  return visits;
}

// Recompute visits over a trailing window so late-arriving (queued offline) pings are folded in.
export function refreshVisits(db, cfg, sinceTs) {
  // Extend the window back to the start of any visit still open at sinceTs, so it isn't split.
  const open = db.prepare('SELECT MIN(start) AS s FROM visits WHERE end >= ?').get(sinceTs);
  if (open?.s != null && open.s < sinceTs) sinceTs = open.s;
  const pings = db.prepare('SELECT * FROM pings WHERE ts >= ? ORDER BY ts').all(sinceTs);
  const visits = detectVisits(pings, cfg.places);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM visits WHERE start >= ?').run(sinceTs);
    const ins = db.prepare('INSERT OR REPLACE INTO visits (start, end, lat, lon, place, division) VALUES (?,?,?,?,?,?)');
    for (const v of visits) ins.run(v.start, v.end, v.lat, v.lon, v.place, v.division);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return visits.length;
}

// Suggest places worth naming: frequent unnamed stays.
export function unnamedHotspots(db, cfg, sinceTs) {
  const rows = db.prepare('SELECT * FROM visits WHERE place IS NULL AND start >= ?').all(sinceTs);
  const clusters = [];
  for (const v of rows) {
    const c = clusters.find(c => haversineM(c, v) < 200);
    const mins = (v.end - v.start) / MIN;
    if (c) { c.visits++; c.minutes += mins; } else clusters.push({ lat: v.lat, lon: v.lon, visits: 1, minutes: mins });
  }
  return clusters.filter(c => c.visits >= 3 || c.minutes >= 240)
    .sort((a, b) => b.minutes - a.minutes).slice(0, 5)
    .map(c => ({ ...c, lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), minutes: Math.round(c.minutes) }));
}
