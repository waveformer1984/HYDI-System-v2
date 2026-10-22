export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function haversineM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Local calendar day (YYYY-MM-DD) for a timestamp in the configured zone.
export function localDay(ts, tz) {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });
}

export function localHour(ts, tz) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ts));
  return Number(h) + new Date(ts).getUTCMinutes() / 60; // minutes are zone-independent for whole-hour offsets
}

// UTC ms for local midnight starting `day` in tz (handles DST by probing the offset).
export function dayStart(day, tz) {
  const [y, m, d] = day.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, 0, 0);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(guess)).reduce((o, p) => (o[p.type] = p.value, o), {});
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    guess += Date.UTC(y, m - 1, d, 0, 0) - asUtc;
  }
  return guess;
}

// UTC ms for a wall-clock time in tz.
export function localToUtc(y, mo, d, h, mi, tz) {
  const day = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return dayStart(day, tz) + h * HOUR + mi * MIN;
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function matchDivision(text, keywords) {
  const t = (text || '').toLowerCase();
  for (const [div, words] of Object.entries(keywords || {})) {
    if (words.some(w => t.includes(w.toLowerCase()))) return div;
  }
  return null;
}

export const fmtH = m => `${(m / 60).toFixed(1)}h`;
export const fmtUsd = c => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
