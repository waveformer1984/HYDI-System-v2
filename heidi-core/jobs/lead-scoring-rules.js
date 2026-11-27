'use strict';

/**
 * Deterministic permit / listing scorer (v2). No network.
 * Field names align with CKAN exports for San Antonio area permit feeds.
 */

const SA_MARKET_RE = /\b(san antonio|bexar|schertz|cibolo|converse|live oak|alamo ranch|stone oak|comal|new braunfels)\b/i;
const CLEAN_RE = /\b(final clean|make[- ]?ready|post[- ]?construction|construction clean|cleaning crew|janitorial.*construction)\b/i;
const NEW_BUILD_RE = /\b(new (single|two)|residential build|new home|single family|duplex|townhome|certificate of occupancy|co\b.*occupancy)\b/i;
const NEGATIVE_TRADE_ONLY_RE = /^(electrical|plumbing|mechanical|hvac|fire sprinkler)\s*(only|permit)?$/i;

function pickField(record, keys) {
  for (const k of keys) {
    const v = record[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function normalizeCkanRecord(record, sourceId) {
  const permitNumber = pickField(record, ['permit_number', 'PermitNumber', 'permit_no', 'PERMIT_NUM']);
  const permitType = pickField(record, ['permit_type', 'PermitType', 'PERMIT_TYPE', 'work_class', 'WorkClass']);
  const workDescription = pickField(record, [
    'work_description',
    'WorkDescription',
    'description',
    'DESCRIPTION',
    'proposed_use',
    'ProposedUse',
  ]);
  const contractor = pickField(record, [
    'contractor_name',
    'Contractor',
    'contractor',
    'CONTRACTOR',
    'general_contractor',
  ]);
  const builder = pickField(record, ['builder_name', 'Builder', 'applicant_name', 'Applicant', 'owner_name']);
  const address = pickField(record, [
    'site_address',
    'Address',
    'street_address',
    'ADDRESS',
    'location',
  ]);
  const issued = pickField(record, ['issued_date', 'IssuedDate', 'applied_date', 'APPLIED_DATE', 'posted_at']);

  const titleParts = [permitType, workDescription].filter(Boolean);
  const title = titleParts.length
    ? titleParts.join(' — ').slice(0, 240)
    : `Permit ${permitNumber || 'unknown'}`;

  const urlBase = record.url || record.permit_url;
  const url =
    urlBase ||
    `https://data.local/permits/${encodeURIComponent(sourceId)}/${encodeURIComponent(permitNumber || title)}`;

  return {
    source: sourceId,
    permit_number: permitNumber || null,
    permit_type: permitType || null,
    title,
    url,
    location: address || null,
    posted_at: issued || null,
    snippet: workDescription || permitType || '',
    contractor: contractor || builder || null,
    builder: builder || contractor || null,
    raw: record,
  };
}

function scorePermitLead(lead) {
  const reasons = [];
  let score = 0.15;

  const blob = [lead.permit_type, lead.snippet, lead.title, lead.location].filter(Boolean).join(' ');

  if (!blob.trim()) {
    return { score: null, score_reasons: ['no_fields_for_rules'], scored_by: null, contractor: lead.contractor };
  }

  if (NEW_BUILD_RE.test(blob)) {
    score += 0.35;
    reasons.push('new_residential_or_occupancy_permit');
  }

  if (CLEAN_RE.test(blob)) {
    score += 0.3;
    reasons.push('explicit_cleaning_or_make_ready');
  }

  if (lead.location && SA_MARKET_RE.test(lead.location)) {
    score += 0.15;
    reasons.push('inside_sa_metro');
  } else if (SA_MARKET_RE.test(blob)) {
    score += 0.1;
    reasons.push('sa_metro_in_text');
  } else {
    score -= 0.25;
    reasons.push('outside_primary_market');
  }

  if (lead.permit_type && NEGATIVE_TRADE_ONLY_RE.test(lead.permit_type.trim())) {
    score -= 0.4;
    reasons.push('trade_only_permit');
  }

  if (/office|admin|clerical|retail\s+admin/i.test(blob) && !NEW_BUILD_RE.test(blob)) {
    score -= 0.35;
    reasons.push('non_field_work');
  }

  score = Math.min(1, Math.max(0, Number(score.toFixed(3))));

  if (reasons.length === 0) {
    return { score: null, score_reasons: [], scored_by: null, contractor: lead.contractor };
  }

  return {
    score,
    score_reasons: reasons,
    scored_by: 'rules',
    contractor: lead.contractor || lead.builder || null,
  };
}

function rollupBuilders(leads) {
  const map = new Map();
  for (const lead of leads) {
    const name = (lead.contractor || lead.builder || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = map.get(key) || { name, count: 0, scoreSum: 0, scored: 0 };
    cur.count += 1;
    if (lead.score != null && Number.isFinite(lead.score)) {
      cur.scoreSum += lead.score;
      cur.scored += 1;
    }
    map.set(key, cur);
  }
  return [...map.values()]
    .map((r) => ({
      name: r.name,
      count: r.count,
      avg_score: r.scored ? Number((r.scoreSum / r.scored).toFixed(3)) : null,
    }))
    .sort((a, b) => b.count - a.count || (b.avg_score || 0) - (a.avg_score || 0));
}

module.exports = {
  normalizeCkanRecord,
  scorePermitLead,
  rollupBuilders,
  SA_MARKET_RE,
};