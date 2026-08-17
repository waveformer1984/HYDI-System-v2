const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME_RE = /^([0-1]?\d|2[0-3]):([0-5]\d)$/;

function dayName(date) {
  return DAYS[date.getUTCDay()];
}

function parseDateString(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toDateString(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function parseTime(time) {
  const m = TIME_RE.exec(time);
  if (!m) return null;
  return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
}

function isValidWeekly(weekly) {
  if (typeof weekly !== 'object' || weekly == null) return false;
  for (const day of DAYS) {
    const slots = weekly[day];
    if (slots == null) continue;
    if (!Array.isArray(slots)) return false;
    for (const slot of slots) {
      if (!slot.start || !slot.end) return false;
      const s = parseTime(slot.start);
      const e = parseTime(slot.end);
      if (!s || !e) return false;
      if (s.hour * 60 + s.minute >= e.hour * 60 + e.minute) return false;
    }
  }
  return true;
}

function dateAtTime(date, time) {
  const t = parseTime(time);
  if (!t) return null;
  const d = new Date(date);
  d.setUTCHours(t.hour, t.minute, 0, 0);
  return d;
}

function getSlotsForDate(profile, exceptions, date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return [];
  const day = dayName(d);
  const dateStr = toDateString(d);
  const base = (profile && profile.weekly && Array.isArray(profile.weekly[day]) ? profile.weekly[day] : []);

  const slots = base.map(slot => ({
    start_time: dateAtTime(d, slot.start).toISOString(),
    end_time: dateAtTime(d, slot.end).toISOString(),
    timezone: profile.timezone || null
  }));

  const dayExceptions = (exceptions || []).filter(e => {
    const start = parseDateString(e.start_time);
    const end = parseDateString(e.end_time);
    if (!start || !end) return false;
    const s = toDateString(start);
    const exEnd = toDateString(end);
    return s === dateStr || exEnd === dateStr || (start <= d && end >= d);
  });

  if (dayExceptions.length === 0) return slots;

  return slots.filter(slot => {
    const slotStart = new Date(slot.start_time);
    const slotEnd = new Date(slot.end_time);
    return !dayExceptions.some(ex => {
      const es = parseDateString(ex.start_time);
      const ee = parseDateString(ex.end_time);
      return es && ee && es < slotEnd && ee > slotStart;
    });
  });
}

function getNextSlot(profile, exceptions, fromDate, lookAheadDays = 30) {
  const from = parseDateString(fromDate) || new Date();
  for (let i = 0; i < lookAheadDays; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const slots = getSlotsForDate(profile, exceptions, d.toISOString());
    if (slots.length) return { date: toDateString(d), slot: slots[0] };
  }
  return null;
}

module.exports = {
  DAYS,
  isValidWeekly,
  getSlotsForDate,
  getNextSlot,
  toDateString,
  parseDateString
};
