'use strict';

function normalizeDomain(website) {
  if (!website) return '';
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
      .hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function richness(lead) {
  return ['website', 'phone', 'email', 'address', 'rating', 'reviewCount']
    .reduce((count, key) => count + (lead[key] !== null && lead[key] !== undefined && lead[key] !== '' ? 1 : 0), 0);
}

function mergeLead(first, second) {
  const primary = richness(second) > richness(first) ? second : first;
  const fallback = primary === first ? second : first;
  return {
    ...fallback,
    ...primary,
    signals: [...new Set([...(first.signals || []), ...(second.signals || [])])],
    sources: [...new Set([...(first.sources || []), ...(second.sources || [])])],
  };
}

function dedupeLeads(leads) {
  const output = [];
  const domainIndex = new Map();
  const phoneIndex = new Map();
  for (const lead of leads) {
    const domain = normalizeDomain(lead.website);
    const phone = normalizePhone(lead.phone);
    let existingIndex;
    if (domain && domainIndex.has(domain)) existingIndex = domainIndex.get(domain);
    else if (phone && phoneIndex.has(phone)) existingIndex = phoneIndex.get(phone);
    if (existingIndex !== undefined) {
      output[existingIndex] = mergeLead(output[existingIndex], lead);
      if (domain) domainIndex.set(domain, existingIndex);
      if (phone) phoneIndex.set(phone, existingIndex);
      continue;
    }
    const index = output.push({ ...lead }) - 1;
    if (domain) domainIndex.set(domain, index);
    if (phone) phoneIndex.set(phone, index);
  }
  return output;
}

function signalMatches(signalId, lead) {
  if (signalId === 'has_website') return !!lead.website;
  if (signalId === 'has_public_email') return !!lead.email;
  if (signalId === 'no_online_booking') return !!lead.website && !lead.hasOnlineBooking;
  const range = /^review_count_(\d+)_(\d+)$/.exec(signalId);
  if (range) {
    const count = Number(lead.reviewCount);
    return Number.isFinite(count) && count >= Number(range[1]) && count <= Number(range[2]);
  }
  if (signalId.startsWith('mentions_')) {
    const phrase = signalId.slice(9).replace(/_/g, ' ');
    return String(lead.websiteText || '').toLowerCase().includes(phrase);
  }
  return false;
}

function disqualifyingReasons(lead, config) {
  const reasons = [];
  for (const rule of config.disqualifiers || []) {
    if (rule === 'permanently_closed' && String(lead.businessStatus || '').toLowerCase().includes('closed')) reasons.push(rule);
    if (rule === 'missing_contact_path' && !lead.website && !lead.phone && !lead.email) reasons.push(rule);
    if (rule === 'national_chain' && lead.isChain) reasons.push(rule);
  }
  return reasons;
}

function scoreLead(lead, config) {
  let score = 30;
  const reasons = ['base local-business fit +30'];
  const signals = [];
  for (const signal of config.qualifying_signals) {
    if (!signalMatches(signal.id, lead)) continue;
    score += signal.weight;
    signals.push(signal.id);
    reasons.push(`${signal.id} +${signal.weight}`);
  }
  if (Number(lead.rating) >= 4 && Number(lead.rating) <= 4.8) {
    score += 6;
    reasons.push('healthy public rating +6');
  }
  if (lead.phone) {
    score += 4;
    reasons.push('public phone +4');
  }
  return {
    ...lead,
    signals: [...new Set([...(lead.signals || []), ...signals])],
    fitScore: Math.max(0, Math.min(100, Math.round(score))),
    fitReasons: reasons,
    disqualifiedBy: disqualifyingReasons(lead, config),
  };
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(value); value = ''; }
    else value += char;
  }
  fields.push(value);
  return fields;
}

function loadSuppression(content) {
  const rows = String(content || '').split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
  if (rows.length < 2) return { domains: new Set(), phones: new Set(), names: new Set() };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const out = { domains: new Set(), phones: new Set(), names: new Set() };
  for (const row of rows.slice(1)) {
    const value = (name) => String(row[headers.indexOf(name)] || '').trim();
    const domain = normalizeDomain(value('domain'));
    const phone = normalizePhone(value('phone'));
    const name = value('business_name').toLowerCase();
    if (domain) out.domains.add(domain);
    if (phone) out.phones.add(phone);
    if (name) out.names.add(name);
  }
  return out;
}

function isSuppressed(lead, suppression) {
  return suppression.domains.has(normalizeDomain(lead.website))
    || suppression.phones.has(normalizePhone(lead.phone))
    || suppression.names.has(String(lead.name || '').trim().toLowerCase());
}

module.exports = {
  dedupeLeads,
  disqualifyingReasons,
  isSuppressed,
  loadSuppression,
  normalizeDomain,
  normalizePhone,
  scoreLead,
};
