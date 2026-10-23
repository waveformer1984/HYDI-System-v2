// End-to-end check with a synthetic two weeks: pings go in over HTTP like the phone would send them.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createServer } from '../src/server.js';
import { refreshVisits } from '../src/places.js';
import { rollupDay } from '../src/analyze.js';
import { runInsights } from '../src/engine.js';
import { parseIcs, expand } from '../src/sources/calendar.js';
import { parseUsagestats } from '../src/sources/usage.js';
import { localDay, addDays, dayStart, MIN, HOUR, DAY } from '../src/util.js';
import { calibrationStats, writeReflection } from '../src/calibrate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heidi-life-'));
const cfg = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
cfg.dbPath = path.join(tmp, 'test.db'); cfg.token = 'test-token-123'; cfg.port = 3471;
cfg.ollama.enabled = false;
const db = openDb(cfg.dbPath);
const tz = cfg.timezone;
const [HOME, SMOKE, SHOP] = cfg.places;
const GYM = { lat: 29.4600, lon: -98.5200 };    // unnamed, visited often
const STORE = { lat: 29.4100, lon: -98.4700 };   // unnamed errands

// deterministic jitter
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const jit = p => ({ lat: p.lat + (rnd() - .5) * 0.0004, lon: p.lon + (rnd() - .5) * 0.0004 });

const today = localDay(Date.now(), tz);
const pings = [];
function stay(place, from, to, charging = false) {
  for (let t = from; t < to; t += 5 * MIN) pings.push({ ts: t, ...jit(place), acc: 20, provider: 'network', battery: 70, charging });
}
function drive(a, b, from, mins) {
  for (let i = 1; i < mins / 5; i++) {
    const f = i / (mins / 5);
    pings.push({ ts: from + i * 5 * MIN, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, acc: 30, battery: 60, charging: false });
  }
}

for (let i = 13; i >= 1; i--) {
  const d = addDays(today, -i), base = dayStart(d, tz);
  const bed = 0.5 + (i % 3) * 1.2;          // 0:30–2:54 AM: short + drifting
  const wake = 7;
  stay(HOME, base, base + bed * HOUR);                       // late evening tail
  stay(HOME, base + bed * HOUR, base + wake * HOUR, true);   // asleep, charging
  const wd = new Date(base + 12 * HOUR).getUTCDay();
  if (i % 4 === 0) { stay(HOME, base + wake * HOUR, base + 24 * HOUR); continue; } // stuck-at-home day
  let t = base + wake * HOUR;
  stay(HOME, t, base + 9 * HOUR); t = base + 9 * HOUR;
  // smokehouse mornings; shop afternoons; gym + scattered errands = extra trips
  const plan = wd % 2 ? [[SMOKE, 180], [HOME, 60], [STORE, 30], [HOME, 90], [GYM, 75], [HOME, 0]]
                      : [[SHOP, 240], [HOME, 45], [STORE, 25], [HOME, 0]];
  let at = HOME;
  for (const [p, mins] of plan) {
    drive(at, p, t, 20); t += 20 * MIN;
    const end = mins ? t + mins * MIN : base + 24 * HOUR;
    stay(p, t, end); t = end; at = p;
  }
}
// today so far
{ const base = dayStart(today, tz); stay(HOME, base, base + 1 * HOUR); stay(HOME, base + 1 * HOUR, base + 7 * HOUR, true); stay(HOME, base + 7 * HOUR, Math.min(Date.now(), base + 15 * HOUR)); }

const server = createServer(db, cfg).listen(cfg.port);
await new Promise(r => server.on('listening', r));
const url = `http://127.0.0.1:${cfg.port}`;

// 1) ingest like the phone: batches of 500, bad token first
const bad = await fetch(`${url}/ingest`, { method: 'POST', headers: { 'x-heidi-token': 'nope' }, body: '{}' });
console.log('bad token →', bad.status);
let stored = 0;
for (let i = 0; i < pings.length; i += 500) {
  const r = await fetch(`${url}/ingest`, { method: 'POST', headers: { 'x-heidi-token': cfg.token, 'content-type': 'application/json' },
    body: JSON.stringify({ pings: pings.slice(i, i + 500) }) }).then(r => r.json());
  stored += r.stored;
}
const dup = await fetch(`${url}/ingest`, { method: 'POST', headers: { 'x-heidi-token': cfg.token }, body: JSON.stringify({ pings: pings.slice(0, 50) }) }).then(r => r.json());
console.log(`ingested ${stored}/${pings.length} pings; re-send duplicates stored=${dup.stored}`);

// 2) calendar: parse a real-shaped ICS with a weekly recurring event
const ics = fs.readFileSync(new URL('./sample.ics', import.meta.url), 'utf8')
  .replaceAll('{{START}}', addDays(today, -13).replaceAll('-', ''));
const evs = expand(parseIcs(ics, tz), Date.now() - 14 * DAY, Date.now() + 7 * DAY, tz);
const upCal = db.prepare('INSERT OR REPLACE INTO cal_events (uid, start, end, title, division, source) VALUES (?,?,?,?,?,?)');
const { matchDivision } = await import('../src/util.js');
for (const e of evs) upCal.run(e.uid, e.start, e.end, e.title, matchDivision(e.title, cfg.divisionKeywords), 'ics');
console.log(`calendar: ${evs.length} event instances; sample:`, evs.slice(0, 2).map(e => `${e.title} @ ${new Date(e.start).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' })}`));

// 3) revenue + usage
const upRev = db.prepare('INSERT INTO revenue (id, ts, amount_cents, currency, description, division) VALUES (?,?,?,?,?,?)');
for (let i = 13; i >= 1; i--) {
  const ts = dayStart(addDays(today, -i), tz) + 14 * HOUR;
  if (i % 2) upRev.run(`ch_s${i}`, ts, 38000, 'usd', 'catering', "Colter's Little Smokehouse");
  if (i % 5 === 0) upRev.run(`ch_g${i}`, ts, 120000, 'usd', 'site build', 'Galactic Bytes');
}
const dump = fs.readFileSync(new URL('./usagestats-sample.txt', import.meta.url), 'utf8');
const parsed = parseUsagestats(dump);
console.log('usagestats parse:', parsed);
const upUse = db.prepare('INSERT OR REPLACE INTO usage (day, pkg, minutes) VALUES (?,?,?)');
for (let i = 6; i >= 0; i--) for (const [pkg, m] of Object.entries(parsed)) upUse.run(addDays(today, -i), pkg, Math.round(m));

// 4) visits + rollups
refreshVisits(db, cfg, Date.now() - 15 * DAY);
const visits = db.prepare('SELECT place, COUNT(*) n, ROUND(SUM(end-start)/3600000.0,1) h FROM visits GROUP BY place ORDER BY h DESC').all();
console.log('visits by place:', visits);
for (let i = 13; i >= 0; i--) rollupDay(db, cfg, addDays(today, -i));
const y = JSON.parse(db.prepare('SELECT json FROM daily WHERE day = ?').get(addDays(today, -1)).json);
console.log('yesterday rollup:', JSON.stringify(y, null, 0));

// 5) insights with gate 1 OFF → everything should be REVIEW or BLOCK
delete process.env.HEIDI_ALLOW_EXEC;
const r1 = await runInsights(db, cfg, today, { withDigest: true });
console.log('\nGATE 1 OFF:');
for (const r of r1) console.log(` [${r.focus}] ${r.kind} conf=${r.confidence.toFixed(2)} → ${r.gate?.verdict ?? 'info'} (${r.gate?.reason ?? ''})\n    ${r.text}`);

// 6) same day again → cooldown/dedup means nothing new
const r2 = await runInsights(db, cfg, today, { withDigest: false });
console.log('re-run same day → new insights:', r2.length);

// 7) gate 1 ON, next day: high-confidence in-bounds actions should AUTO-APPROVE and execute
process.env.HEIDI_ALLOW_EXEC = 'true';
db.exec('DELETE FROM insights'); // simulate cooldown expired
const r3 = await runInsights(db, cfg, today, { withDigest: false });
console.log('\nGATE 1 ON:');
for (const r of r3) console.log(` ${r.kind} conf=${r.confidence.toFixed(2)} → ${r.gate?.verdict ?? 'info'} (${r.gate?.reason ?? ''})`);

// 8) bounds: a rogue action type and a quiet-hours notify must BLOCK even with exec on
const { propose } = await import('../src/gate.js');
console.log('\nbounds checks:');
console.log(' send_message →', propose(db, cfg, null, { type: 'send_message', confidence: 0.99, payload: { to: 'someone' } }).verdict);
console.log(' notify at 2AM →', propose(db, cfg, null, { type: 'notify', confidence: 0.99, payload: { title: 'x', body: 'y', at: dayStart(addDays(today, 1), tz) + 2 * HOUR } }).reason);
console.log(' 4h focus block →', propose(db, cfg, null, { type: 'focus_block', confidence: 0.99, payload: { title: 'x', start: dayStart(addDays(today, 2), tz) + 9 * HOUR, end: dayStart(addDays(today, 2), tz) + 13 * HOUR } }).reason);

// 9) approve a pending REVIEW from "Frank" (localhost) and fetch phone notifications
const pending = db.prepare("SELECT id, type FROM actions WHERE status = 'pending' LIMIT 1").get();
if (pending) console.log(`approve #${pending.id} (${pending.type}) →`, await fetch(`${url}/api/actions/${pending.id}/approve`, { method: 'POST' }).then(r => r.json()));
db.prepare('UPDATE notifications SET deliver_at = 0').run(); // make all due for the test
const notes = await fetch(`${url}/api/notifications/pending`, { headers: { 'x-heidi-token': cfg.token } }).then(r => r.json());
console.log('phone notifications delivered:', notes.notifications.map(n => n.title));
const again = await fetch(`${url}/api/notifications/pending`, { headers: { 'x-heidi-token': cfg.token } }).then(r => r.json());
console.log('second poll (should be empty):', again.notifications.length);
const icsOut = await fetch(`${url}/calendar/heidi.ics?token=${cfg.token}`).then(r => r.text());
console.log('focus ICS events:', (icsOut.match(/BEGIN:VEVENT/g) || []).length);

const sum = await fetch(`${url}/api/summary`).then(r => r.json());
console.log('summary: days', sum.days.length, 'insights', sum.insights.length, 'actions', sum.actions.length, 'digest source', sum.digest?.source);
console.log('\nDB in', tmp);
server.close();

// 10) Tailscale address check used for remote approvals
const { isTailnet } = await import('../src/server.js');
const cases = { '100.101.5.9': true, '::ffff:100.64.0.1': true, '100.128.0.1': false, '192.168.1.50': false, 'fd7a:115c:a1e0::12': true, '2001:db8::1': false };
const fails = Object.entries(cases).filter(([a, want]) => isTailnet(a) !== want);
console.log('tailnet address checks:', fails.length ? `FAIL ${JSON.stringify(fails)}` : `all ${Object.keys(cases).length} pass`);

// 11) model URL must stay private (the digest prompt carries personal data)
const { isPrivateModelUrl } = await import('../src/llm.js');
const urls = { 'http://127.0.0.1:11434': true, 'http://localhost:11434': true, 'http://192.168.1.100:11434': true, 'http://frank:11434': true,
  'http://heidi-pc.tailc50af2.ts.net:11434': true, 'http://100.88.1.2:11434': true, 'https://api.example.com': false, 'http://8.8.8.8:11434': false, 'file:///etc/passwd': false, 'nonsense': false };
const ubad = Object.entries(urls).filter(([u, want]) => isPrivateModelUrl(u) !== want);
console.log('model URL checks:', ubad.length ? `FAIL ${JSON.stringify(ubad)}` : `all ${Object.keys(urls).length} pass`);

// 12) ICS text escaping
const db2 = openDb(path.join(tmp, 'ics.db'));
db2.prepare('INSERT INTO focus_blocks (start, end, title) VALUES (?,?,?)').run(Date.now(), Date.now() + HOUR, 'Focus: A\\B, C; D\nE');
const srv2 = createServer(db2, cfg).listen(3473);
await new Promise(r => srv2.on('listening', r));
const icsBody = await fetch(`http://127.0.0.1:3473/calendar/heidi.ics?token=${cfg.token}`).then(r => r.text());
const summaryLine = icsBody.split('\r\n').find(l => l.startsWith('SUMMARY:'));
console.log('ICS escaping:', summaryLine === 'SUMMARY:Focus: A\\\\B\\, C\\; D\\nE' ? 'pass' : `FAIL ${summaryLine}`);
srv2.close();

// 13) calibration: Jordan's repeated rejections can only lower confidence.
const beforeCalibration = calibrationStats(db);
console.log('\nCALIBRATION BEFORE:', beforeCalibration.map(s => `${s.kind}=${s.multiplier.toFixed(2)}`).join(', ') || 'no decisions');
assert.ok(beforeCalibration.every(s => s.multiplier === 1), 'fewer than five human decisions must not change a multiplier');

function seedHumanDecisions(kind, status, count) {
  const seedDay = addDays(today, -61);
  const { lastInsertRowid: insightId } = db.prepare(
    'INSERT INTO insights (day, kind, focus, text, confidence, created) VALUES (?,?,?,?,?,?)'
  ).run(seedDay, kind, 'calibration test', 'seed decision', 0.9, Date.now());
  const insert = db.prepare(
    'INSERT INTO actions (created, insight_id, type, payload, confidence, raw_confidence, verdict, reason, status, executed) VALUES (?,?,?,?,?,?,?,?,?,?)'
  );
  for (let i = 0; i < count; i++) {
    insert.run(Date.now(), insightId, 'notify', '{}', 0.9, 0.9, 'REVIEW', 'seed decision', status, status === 'executed' ? Date.now() : null);
  }
  return Number(insightId);
}

const socialSeedId = seedHumanDecisions('social_screen', 'rejected', 10);
seedHumanDecisions('sleep_short', 'executed', 10);
const afterCalibration = calibrationStats(db);
const socialStats = afterCalibration.find(s => s.kind === 'social_screen');
const sleepStats = afterCalibration.find(s => s.kind === 'sleep_short');
assert.ok(socialStats.multiplier < 1, 'social_screen multiplier should fall after repeated rejections');
assert.equal(sleepStats.multiplier, 1, 'sleep_short multiplier should stay at 1.0 after approvals');
assert.ok(afterCalibration.every(s => s.multiplier >= 0.5 && s.multiplier <= 1), 'every multiplier must stay in [0.5, 1.0]');

// Remove only prior generated social insights so the real generation/gate path can propose it again.
db.prepare('DELETE FROM insights WHERE kind = ? AND id != ?').run('social_screen', socialSeedId);
const calibratedRun = await runInsights(db, cfg, today, { withDigest: false });
const socialProposal = calibratedRun.find(result => result.kind === 'social_screen');
assert.ok(socialProposal, 'social_screen should produce a calibrated proposal');
assert.equal(socialProposal.gate.verdict, 'REVIEW', 'calibrated social_screen proposal must not auto-approve');
assert.ok(socialProposal.action.confidence < socialProposal.action.rawConfidence, 'action confidence should be calibrated downward');
const storedSocial = db.prepare('SELECT raw_confidence, confidence FROM actions WHERE id = ?').get(socialProposal.gate.id);
assert.equal(storedSocial.raw_confidence, socialProposal.action.rawConfidence);
assert.equal(storedSocial.confidence, socialProposal.action.confidence);

const reflectionResult = await writeReflection(db, cfg);
assert.equal(reflectionResult.written, true, 'weekly self-review should write a reflection');
assert.equal((await writeReflection(db, cfg)).written, false, 'self-review should run only once for a local day');
assert.equal(db.prepare('SELECT COUNT(*) n FROM reflections').get().n, 1);
console.log('CALIBRATION AFTER:', afterCalibration
  .filter(s => ['social_screen', 'sleep_short'].includes(s.kind))
  .map(s => `${s.kind}: approved=${s.approved} rejected=${s.rejected} multiplier=${s.multiplier.toFixed(2)}`)
  .join(' | '));
console.log(`NEXT social_screen: raw=${socialProposal.action.rawConfidence.toFixed(2)} calibrated=${socialProposal.action.confidence.toFixed(2)} → ${socialProposal.gate.verdict}`);
console.log(`SELF-REVIEW: ${reflectionResult.reflection.note}`);
console.log('calibration assertions: all pass');
