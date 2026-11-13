'use strict';
/**
 * Deterministic lead scoring against the division profiles in
 * config/job-scout.json. No model call: the same lead and config always get
 * the same score, which keeps the ranking explainable and testable.
 *
 * Per division, each matched keyword counts once at its strongest location:
 * title 30, listed skills 20, description 8. The best division wins (capped
 * at 100). Then:
 *   - any negative keyword            -> score 0 (kept out of the feed)
 *   - budget below the configured floor -> -30
 *   - posted more than 14 days ago     -> -15
 */

const W_TITLE = 30;
const W_SKILL = 20;
const W_DESC = 8;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary match so short keywords ("ai", "cad", "ux") don't match
// inside other words ("email", "cascade", "luxury").
function makeMatcher(keyword) {
  const k = String(keyword).toLowerCase().trim();
  return new RegExp(`(^|[^a-z0-9])${escapeRe(k)}($|[^a-z0-9])`, 'i');
}

function compileProfile(config) {
  const divisions = Object.entries(config.divisions || {}).map(([name, d]) => ({
    name,
    pitch: d.pitch || '',
    keywords: (d.keywords || []).map((k) => ({ k, re: makeMatcher(k) })),
  }));
  const negatives = (config.negativeKeywords || []).map((k) => ({ k, re: makeMatcher(k) }));
  return {
    divisions,
    negatives,
    minFixedBudgetUsd: Number(config.minFixedBudgetUsd) || 0,
    minHourlyUsd: Number(config.minHourlyUsd) || 0,
  };
}

function budgetTooLow(lead, profile) {
  const b = lead.budget || {};
  if ((b.currency || 'USD') !== 'USD') return false; // don't guess FX
  const top = Number.isFinite(b.max) && b.max ? b.max : b.min;
  if (!Number.isFinite(top) || !top) return false;
  if (b.type === 'fixed') return top < profile.minFixedBudgetUsd;
  if (b.type === 'hourly') return top < profile.minHourlyUsd;
  return false;
}

function scoreLead(lead, profile, now = Date.now()) {
  const title = String(lead.title || '');
  const skills = (lead.skills || []).join(' | ');
  const desc = String(lead.description || '');
  const all = `${title}\n${skills}\n${desc}`;

  const neg = profile.negatives.find((n) => n.re.test(all));
  if (neg) {
    return { score: 0, division: null, matched: [], reasons: [`excluded: "${neg.k}"`] };
  }

  let best = { score: 0, division: null, matched: [] };
  for (const d of profile.divisions) {
    let pts = 0;
    const matched = [];
    for (const { k, re } of d.keywords) {
      const w = re.test(title) ? W_TITLE : re.test(skills) ? W_SKILL : re.test(desc) ? W_DESC : 0;
      if (w) { pts += w; matched.push(k); }
    }
    pts = Math.min(100, pts);
    if (pts > best.score) best = { score: pts, division: d.name, matched };
  }

  const reasons = best.matched.length ? [`matches ${best.division}: ${best.matched.slice(0, 6).join(', ')}`] : ['no division keywords matched'];
  let score = best.score;
  if (score > 0 && budgetTooLow(lead, profile)) { score -= 30; reasons.push('budget below floor'); }
  const posted = lead.postedAt ? Date.parse(lead.postedAt) : NaN;
  if (score > 0 && Number.isFinite(posted) && now - posted > 14 * 86400000) { score -= 15; reasons.push('older than 14 days'); }

  return { score: Math.max(0, Math.min(100, score)), division: best.division, matched: best.matched, reasons };
}

module.exports = { compileProfile, scoreLead, makeMatcher, budgetTooLow };
