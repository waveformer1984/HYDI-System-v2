// Triple-gate authorization, matching the HYDI v3 model:
//   Gate 1  HEIDI_ALLOW_EXEC=true in Frank's environment
//   Gate 2  confidence >= gate.minConfidence (0.85)
//   Gate 3  action type + payload inside gate.bounds
// All three → AUTO-APPROVE and execute. Gate 3 fails → BLOCK. Otherwise → REVIEW (you approve on the dashboard).
//
// Only three executors exist: notify, focus_block, journal. There is deliberately no code path for
// messaging other people, spending, deleting, or sharing location — those can't be approved because
// nothing exists to run them.
import { audit } from './db.js';
import { localDay, localHour, MIN } from './util.js';

const EXECUTORS = {
  notify(db, p) {
    db.prepare('INSERT INTO notifications (created, deliver_at, title, body, delivered) VALUES (?,?,?,?,0)')
      .run(Date.now(), Math.max(Date.now(), p.at || 0), p.title, p.body);
  },
  focus_block(db, p, actionId, cfg) {
    db.prepare('INSERT INTO focus_blocks (start, end, title, action_id) VALUES (?,?,?,?)').run(p.start, p.end, p.title, actionId);
    db.prepare('INSERT INTO notifications (created, deliver_at, title, body, delivered) VALUES (?,?,?,?,0)')
      .run(Date.now(), p.start, p.title, `Blocked until ${new Date(p.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: cfg.timezone })}. Phone down.`);
  },
  journal(db, p) { audit(db, 'journal', p); }
};

export function checkBounds(db, cfg, type, p) {
  const b = cfg.gate.bounds[type];
  if (!b || !EXECUTORS[type]) return `no executor/bounds for "${type}"`;
  const tz = cfg.timezone;
  const when = type === 'notify' ? Math.max(Date.now(), p.at || 0) : type === 'focus_block' ? p.start : Date.now();
  const day = localDay(when, tz);
  const sameDay = db.prepare("SELECT payload FROM actions WHERE type = ? AND status = 'executed'").all(type)
    .filter(r => { const q = JSON.parse(r.payload); return localDay(type === 'focus_block' ? q.start : (q.at || 0), tz) === day; }).length;
  if (b.maxPerDay != null && sameDay >= b.maxPerDay) return `${type} limit ${b.maxPerDay}/day reached for ${day}`;
  if (type === 'notify') {
    const h = localHour(when, tz), [qs, qe] = b.quietHours || [];
    if (qs != null && (qs > qe ? (h >= qs || h < qe) : (h >= qs && h < qe))) return `inside quiet hours (${qs}:00–${qe}:00)`;
    if (!p.title || !p.body) return 'notify needs title and body';
  }
  if (type === 'focus_block') {
    const mins = (p.end - p.start) / MIN;
    if (!(mins > 0) || mins > b.maxMinutes) return `block length ${mins}m outside 1–${b.maxMinutes}m`;
    if (p.start < Date.now()) return 'block starts in the past';
    if (db.prepare('SELECT 1 FROM focus_blocks WHERE end > ? AND start < ?').get(p.start, p.end)) return 'overlaps an existing focus block';
    if (localHour(p.start, tz) < b.earliestHour || localHour(p.end - 1, tz) >= b.latestHour) return `outside ${b.earliestHour}:00–${b.latestHour}:00`;
  }
  return null;
}

export function evaluate(db, cfg, action) {
  const reasons = [];
  const g1 = process.env[cfg.gate.allowExecEnvVar || 'HEIDI_ALLOW_EXEC'] === 'true';
  const g2 = action.confidence >= cfg.gate.minConfidence;
  const boundsFail = checkBounds(db, cfg, action.type, action.payload);
  if (boundsFail) return { verdict: 'BLOCK', reason: boundsFail };
  if (!g1) reasons.push('HEIDI_ALLOW_EXEC is off');
  if (!g2) reasons.push(`confidence ${action.confidence.toFixed(2)} < ${cfg.gate.minConfidence}`);
  return reasons.length ? { verdict: 'REVIEW', reason: reasons.join('; ') } : { verdict: 'AUTO-APPROVE', reason: 'all three gates passed' };
}

export function propose(db, cfg, insightId, action) {
  const v = evaluate(db, cfg, action);
  const status = v.verdict === 'AUTO-APPROVE' ? 'approved' : v.verdict === 'REVIEW' ? 'pending' : 'blocked';
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO actions (created, insight_id, type, payload, confidence, verdict, reason, status, executed) VALUES (?,?,?,?,?,?,?,?,NULL)'
  ).run(Date.now(), insightId, action.type, JSON.stringify(action.payload), action.confidence, v.verdict, v.reason, status);
  audit(db, 'gate', { id: Number(id), type: action.type, ...v });
  if (status === 'approved') execute(db, cfg, Number(id));
  return { id: Number(id), ...v };
}

export function execute(db, cfg, id, by = 'heidi') {
  const a = db.prepare('SELECT * FROM actions WHERE id = ?').get(id);
  if (!a || a.status === 'executed') return { ok: false, error: 'not found or already executed' };
  const p = JSON.parse(a.payload);
  const fail = checkBounds(db, cfg, a.type, p); // bounds still apply when *you* approve
  if (fail) {
    db.prepare("UPDATE actions SET status = 'blocked', reason = ? WHERE id = ?").run(fail, id);
    return { ok: false, error: fail };
  }
  EXECUTORS[a.type](db, p, id, cfg);
  db.prepare("UPDATE actions SET status = 'executed', executed = ? WHERE id = ?").run(Date.now(), id);
  audit(db, 'execute', { id, type: a.type, by });
  return { ok: true };
}

export function reject(db, id, by = 'jordan') {
  db.prepare("UPDATE actions SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(id);
  audit(db, 'reject', { id, by });
}
