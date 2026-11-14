'use strict';
/**
 * Morning brief — one plain-text digest for the phone, shown at the top of
 * /heidi. Every source is isolated: a failed source is named in `failures`
 * and the rest of the brief still renders. Read-only; writes nothing.
 *
 * Sources:
 *   shifts   — "Work – RC …" events for today (CT). Reads an iCal feed from
 *              HEIDI_CALENDAR_ICS_URL or a local JSON file at
 *              <root>/.runtime/brief/shifts.json ({events:[{title,start}]}).
 *              Neither configured -> reported as unavailable, not fatal.
 *   health   — .runtime/observation/frank.json (PM2 up/down, Ollama, storage)
 *              plus a live C: free-space probe.
 *   prs      — open PRs on clean-main + latest commit statuses (GitHub API,
 *              public repo, no token; 10-min cache shared with system-status).
 *   approvals— decision-inbox awaiting count (missions + critical fix-list).
 *
 *   GET /morning-brief -> { generatedAt, ctDate, lines[], failures[] }
 */
const fs = require('fs');
const path = require('path');
const { decisionInbox } = require('./decision-inbox');

const CT = 'America/Chicago';
const GITHUB_REPO = process.env.HYDI_GITHUB_REPO || 'waveformer1984/HYDI-System-v2';
const FETCH_TIMEOUT_MS = 6000;

function ctDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CT, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function todayInCT(now = new Date()) {
  // [startMs, endMs) of the current CT calendar day as UTC instants.
  const { date } = ctDateParts(now);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: CT, year: 'numeric', month: '2-digit', day: '2-digit' });
  let t = Date.parse(`${date}T00:00:00-06:00`); // CDT guess
  if (fmt.format(new Date(t)) !== date) t = Date.parse(`${date}T00:00:00-05:00`); // CST guess
  if (fmt.format(new Date(t)) !== date) t += 3600_000;
  return [t, t + 24 * 3600_000];
}

function parseIcsEvents(ics, [dayStart, dayEnd]) {
  const events = [];
  for (const block of ics.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (k) => {
      const m = body.match(new RegExp(`^${k}[^:]*:(.+)$`, 'm'));
      return m ? m[1].trim() : null;
    };
    const dtstart = get('DTSTART');
    if (!dtstart) continue;
    const m = dtstart.match(/^DTSTART(?:;[^:]*)?:(\d{8})(?:T(\d{6})Z?)?/);
    if (!m) continue;
    const isUtc = /Z$/.test(dtstart.split(':')[1] || '');
    const [y, mo, d] = [m[1].slice(0, 4), m[1].slice(4, 6), m[1].slice(6, 8)];
    let startMs;
    if (m[2]) {
      // Floating local time -> interpret as CT.
      const hh = m[2].slice(0, 2), mm = m[2].slice(2, 4);
      startMs = isUtc ? Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:00Z`)
        : Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:00-06:00`) || Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:00-05:00`);
    } else {
      startMs = Date.parse(`${y}-${mo}-${d}T00:00:00-06:00`);
    }
    const today = ctDateParts(new Date()).date;
    if (ctDateParts(new Date(startMs)).date !== today) continue;
    events.push({ title: (get('SUMMARY') || '(untitled)').replace(/\\([,;\\])/g, '$1'), start: new Date(startMs).toISOString(), allDay: !m[2] });
  }
  return events;
}

async function getJson(fetchImpl, url, timeoutMs = FETCH_TIMEOUT_MS) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'heidi-brief' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sourceShifts(env, root, fetchImpl, failures) {
  const icsUrl = env.HEIDI_CALENDAR_ICS_URL;
  const localFile = path.join(root, '.runtime', 'brief', 'shifts.json');
  try {
    const [dayStart, dayEnd] = todayInCT();
    let events = [];
    if (icsUrl) {
      const res = await fetchImpl(icsUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`calendar HTTP ${res.status}`);
      events = parseIcsEvents(await res.text(), [dayStart, dayEnd]);
    } else if (fs.existsSync(localFile)) {
      const data = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      const today = ctDateParts().date;
      events = (data.events || []).filter((e) => String(e.date || e.start || '').startsWith(today) || (e.start && ctDateParts(new Date(e.start)).date === today));
    } else {
      return { state: 'unavailable', reason: 'no calendar source (set HEIDI_CALENDAR_ICS_URL or .runtime/brief/shifts.json)' };
    }
    const shifts = events.filter((e) => /work/i.test(e.title));
    return { state: 'ok', events: shifts.map((e) => ({ title: e.title, start: e.start })) };
  } catch (e) {
    failures.push(`calendar: ${e.message}`);
    return { state: 'failed', reason: e.message };
  }
}

function sourceHealth(root, failures) {
  try {
    const f = path.join(root, '.runtime', 'observation', 'frank.json');
    const obs = JSON.parse(fs.readFileSync(f, 'utf8'));
    const pm2 = obs.pm2 || {};
    const down = (pm2.errored || []);
    const ollamaUp = obs.ollama?.reachable === true;
    let freeGb = null;
    try {
      const s = fs.statfsSync(process.env.SystemDrive || 'C:\\');
      freeGb = Math.round(((s.bavail * s.bsize) / 1073741824) * 10) / 10;
    } catch { /* statfs unsupported */ }
    const storage = obs.storage || {};
    if (freeGb == null) freeGb = storage.freeGb ?? null;
    return {
      state: 'ok',
      pm2: { online: pm2.online ?? null, total: pm2.total ?? null, down: down.length ? down : (pm2.total && pm2.online != null && pm2.online < pm2.total ? [`${pm2.total - pm2.online} app(s) not online`] : []) },
      diskFreeGb: freeGb,
      ollama: ollamaUp ? 'up' : 'down',
      obsAgeMin: obs.at ? Math.round((Date.now() - Date.parse(obs.at)) / 60000) : null,
    };
  } catch (e) {
    failures.push(`health snapshot: ${e.message}`);
    return { state: 'failed', reason: e.message };
  }
}

const _prCache = { at: 0, prs: null, statuses: null };

async function sourcePrs(fetchImpl, failures) {
  try {
    const now = Date.now();
    if (now - _prCache.at > 10 * 60_000 || !_prCache.prs) {
      const prs = await getJson(fetchImpl, `https://api.github.com/repos/${GITHUB_REPO}/pulls?state=open&per_page=20`);
      const statuses = await getJson(fetchImpl, `https://api.github.com/repos/${GITHUB_REPO}/commits/clean-main/status`);
      _prCache.at = now;
      _prCache.prs = (Array.isArray(prs) ? prs : []).map((p) => ({ number: p.number, title: p.title, draft: !!p.draft }));
      const latest = {};
      for (const s of statuses.statuses || []) {
        if (!latest[s.context] || String(s.created_at) > String(latest[s.context].created_at)) latest[s.context] = s;
      }
      _prCache.statuses = Object.entries(latest).map(([ctx, s]) => `${ctx}=${s.state}`);
    }
    return { state: 'ok', open: _prCache.prs.length, prs: _prCache.prs.slice(0, 5), ci: _prCache.statuses };
  } catch (e) {
    failures.push(`github: ${e.message}`);
    return { state: 'failed', reason: e.message };
  }
}

async function sourceApprovals(memory, root, failures) {
  try {
    const inbox = await decisionInbox(memory, root, { timeoutMs: 4000 });
    return { state: 'ok', awaiting: inbox.counts.awaitingApproval + inbox.counts.fixListCrit, top: inbox.cards.slice(0, 3).map((c) => c.decision) };
  } catch (e) {
    failures.push(`approvals: ${e.message}`);
    return { state: 'failed', reason: e.message };
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { timeZone: CT, hour: 'numeric', minute: '2-digit' });
}

function renderLines({ shifts, health, prs, approvals }, ctDate) {
  const lines = [`Morning brief — ${ctDate} (CT)`];
  if (shifts.state === 'ok') {
    lines.push(shifts.events.length ? `Shift: ${shifts.events.map((e) => `${e.title} @ ${fmtTime(e.start)}`).join('; ')}` : 'Shift: none on calendar today');
  } else {
    lines.push(`Shift: ${shifts.state === 'unavailable' ? 'calendar not configured' : `calendar unavailable (${shifts.reason})`}`);
  }
  if (health.state === 'ok') {
    const h = health;
    const bits = [];
    bits.push(h.pm2.total ? `PM2 ${h.pm2.online}/${h.pm2.total} up` : 'PM2 unknown');
    if (h.pm2.down.length) bits.push(`down: ${h.pm2.down.slice(0, 3).join(', ')}`);
    bits.push(h.diskFreeGb != null ? `C: ${h.diskFreeGb} GB free` : 'C: disk unknown');
    bits.push(`Ollama ${h.ollama}`);
    lines.push(`System: ${bits.join(' · ')}`);
  } else {
    lines.push(`System: health snapshot unavailable (${health.reason})`);
  }
  if (prs.state === 'ok') {
    lines.push(`PRs: ${prs.open} open${prs.prs.length ? ` — ${prs.prs.map((p) => `#${p.number}`).join(', ')}` : ''}`);
    if (prs.ci?.length) lines.push(`CI: ${prs.ci.join(', ')}`);
  } else {
    lines.push(`PRs: github unavailable (${prs.reason})`);
  }
  if (approvals.state === 'ok') {
    lines.push(approvals.awaiting ? `Needs you: ${approvals.awaiting} item(s) — ${approvals.top.join('; ')}` : 'Needs you: nothing pending');
  } else {
    lines.push(`Needs you: approvals unavailable (${approvals.reason})`);
  }
  return lines;
}

/**
 * Build the brief. opts: { root, memory, fetchImpl, env, now }
 * Returns { generatedAt, ctDate, lines, sections, failures }.
 */
async function morningBrief(opts = {}) {
  const root = opts.root || process.cwd();
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const failures = [];
  const now = opts.now || new Date();
  const { date: ctDate } = ctDateParts(now);

  const [shifts, health, prs, approvals] = await Promise.all([
    sourceShifts(env, root, fetchImpl, failures),
    Promise.resolve().then(() => sourceHealth(root, failures)),
    sourcePrs(fetchImpl, failures),
    sourceApprovals(opts.memory, root, failures),
  ]);

  const sections = { shifts, health, prs, approvals };
  return { generatedAt: now.toISOString(), ctDate, lines: renderLines(sections, ctDate), sections, failures };
}

/** Cache is good for the CT day it's generated on, refreshed hourly. */
function briefDue(cached, now = new Date()) {
  const { date } = ctDateParts(now);
  if (!cached || cached.ctDate !== date) return true;
  return now - Date.parse(cached.generatedAt) > 60 * 60_000;
}

/** Milliseconds until the next 07:30 CT, for the daily pre-generation timer. */
function msUntilNextBrief(now = new Date()) {
  const { date, minutes } = ctDateParts(now);
  let target;
  if (minutes < 7 * 60 + 30) {
    // Later today at 07:30 CT. CT is UTC-5 (CST) or -6 (CDT); try both, pick the one landing on `date`.
    for (const off of ['-05:00', '-06:00']) {
      const t = Date.parse(`${date}T07:30:00${off}`);
      if (ctDateParts(new Date(t)).date === date) { target = t; break; }
    }
  }
  if (!target) {
    const tomorrow = new Date(now.getTime() + 24 * 3600_000);
    const { date: d2 } = ctDateParts(tomorrow);
    for (const off of ['-05:00', '-06:00']) {
      const t = Date.parse(`${d2}T07:30:00${off}`);
      if (ctDateParts(new Date(t)).date === d2) { target = t; break; }
    }
  }
  return Math.max(1000, (target || now.getTime() + 3600_000) - now.getTime());
}

module.exports = { morningBrief, briefDue, msUntilNextBrief, ctDateParts, parseIcsEvents };
