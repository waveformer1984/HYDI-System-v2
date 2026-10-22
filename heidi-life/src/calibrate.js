// Local confidence calibration from Jordan's decisions. Multipliers are deliberately
// one-way: they can only leave confidence unchanged or make Heidi more cautious.
import { selfReview } from './llm.js';
import { audit } from './db.js';
import { localDay, DAY } from './util.js';

const MIN_HUMAN_DECISIONS = 5;
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 1.0;

const clampMultiplier = value => Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, value));

export function calibrationStats(db, { now = Date.now(), days = 60 } = {}) {
  const rows = db.prepare(`
    SELECT i.kind,
      COUNT(*) AS proposed,
      SUM(CASE WHEN a.verdict = 'REVIEW' AND a.status = 'executed' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN a.verdict = 'REVIEW' AND a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN a.verdict = 'AUTO-APPROVE' THEN 1 ELSE 0 END) AS auto_approved
    FROM actions a
    JOIN insights i ON i.id = a.insight_id
    WHERE a.created >= ?
    GROUP BY i.kind
    ORDER BY i.kind
  `).all(now - days * DAY);

  return rows.map(row => {
    const approved = Number(row.approved);
    const rejected = Number(row.rejected);
    const humanDecisions = approved + rejected;
    const approvalRate = humanDecisions ? approved / humanDecisions : null;
    const rejectionRate = humanDecisions ? rejected / humanDecisions : 0;
    const multiplier = humanDecisions < MIN_HUMAN_DECISIONS
      ? MAX_MULTIPLIER
      : clampMultiplier(MAX_MULTIPLIER - rejectionRate * 0.5);
    return {
      kind: row.kind,
      proposed: Number(row.proposed),
      approved,
      rejected,
      autoApproved: Number(row.auto_approved),
      humanDecisions,
      approvalRate,
      multiplier
    };
  });
}

export function calibrationByKind(db, options) {
  return new Map(calibrationStats(db, options).map(stat => [stat.kind, stat]));
}

export function calibrateConfidence(confidence, multiplier = MAX_MULTIPLIER) {
  return Math.min(Number(confidence), Number(confidence) * clampMultiplier(multiplier));
}

export function calibrateInsights(db, insights, options) {
  const byKind = calibrationByKind(db, options);
  return insights.map(insight => {
    const multiplier = byKind.get(insight.kind)?.multiplier ?? MAX_MULTIPLIER;
    const calibrated = {
      ...insight,
      rawConfidence: insight.confidence,
      confidence: calibrateConfidence(insight.confidence, multiplier),
      calibrationMultiplier: multiplier
    };
    if (insight.action) {
      calibrated.action = {
        ...insight.action,
        rawConfidence: insight.action.confidence,
        confidence: calibrateConfidence(insight.action.confidence, multiplier)
      };
    }
    return calibrated;
  });
}

export function latestReflection(db) {
  const row = db.prepare('SELECT * FROM reflections ORDER BY created DESC, id DESC LIMIT 1').get();
  return row ? { ...row, stats: JSON.parse(row.stats), changes: JSON.parse(row.changes) } : null;
}

export async function writeReflection(db, cfg, now = Date.now()) {
  const day = localDay(now, cfg.timezone);
  const existing = db.prepare('SELECT * FROM reflections WHERE day = ?').get(day);
  if (existing) return { written: false, reflection: latestReflection(db) };

  const stats = calibrationStats(db, { now });
  const previous = latestReflection(db);
  const priorByKind = new Map((previous?.stats || []).map(stat => [stat.kind, stat.multiplier]));
  const changes = stats
    .map(stat => ({ kind: stat.kind, from: priorByKind.get(stat.kind) ?? MAX_MULTIPLIER, to: stat.multiplier }))
    .filter(change => change.from !== change.to);
  const review = await selfReview(cfg, stats, changes);
  const result = db.prepare(
    'INSERT OR IGNORE INTO reflections (day, created, stats, changes, note, source) VALUES (?,?,?,?,?,?)'
  ).run(day, now, JSON.stringify(stats), JSON.stringify(changes), review.text, review.source);
  if (result.changes) audit(db, 'reflection', { day, changes, source: review.source });
  return { written: !!result.changes, reflection: latestReflection(db) };
}
