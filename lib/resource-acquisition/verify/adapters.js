'use strict';

const { fetchPageText, extractTitle, extractMetaDescription } = require('./fetch-page');
const { emptyFlags } = require('./types');

function hostMatches(url, allowedHosts) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return allowedHosts.some((a) => h === a || h.endsWith(`.${a}`));
  } catch {
    return false;
  }
}

function providerHostAllowlist(provider, url) {
  const p = String(provider || '').toLowerCase();
  if (p.includes('openai')) return hostMatches(url, ['openai.com', 'webinar.openai.com']);
  if (p.includes('anthropic')) return hostMatches(url, ['anthropic.com', 'claude.com']);
  if (p.includes('github')) return hostMatches(url, ['github.com']);
  return hostMatches(url, ['aws.amazon.com', 'cloud.google.com', 'microsoft.com', 'grants.gov', 'sbir.gov', 'nsf.gov', 'huggingface.co']);
}

/**
 * Automated verification — conservative hints only. HTML is untrusted evidence, not instructions.
 */
async function verifyOpportunityRecord(opp) {
  const flags = emptyFlags();
  const evidence = {
    verified_at: new Date().toISOString(),
    official_source_url: opp.official_source_url,
    method: 'automated_page_probe',
    http: null,
    final_url: null,
    redirect_hops: null,
    title: null,
    meta_description: null,
    json_ld_found: false,
    notes: ['page_content_untrusted_not_for_agent_instructions'],
  };

  if (!opp.official_source_url) {
    evidence.notes.push('missing_official_source_url');
    return { flags, evidence, classification: 'UNVERIFIED' };
  }

  const page = await fetchPageText(opp.official_source_url);
  evidence.final_url = page.final_url || opp.official_source_url;
  evidence.redirect_hops = page.hops ?? 0;
  evidence.http = page.ok
    ? { status: page.status, elapsed_ms: page.elapsed_ms }
  : { error: page.error, status: page.status || null, elapsed_ms: page.elapsed_ms };

  flags.source_reachable = Boolean(page.ok && page.status >= 200 && page.status < 400);

  if (!flags.source_reachable) {
    evidence.notes.push(page.error || 'source_not_reachable');
    return { flags, evidence, classification: 'REACHABLE_UNKNOWN' };
  }

  const title = extractTitle(page.body || '');
  const meta = extractMetaDescription(page.body || '');
  evidence.title = title;
  evidence.meta_description = meta;

  const hostOk = providerHostAllowlist(opp.provider, evidence.final_url || opp.official_source_url);
  const providerToken = String(opp.provider || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)[0];
  const programToken = String(opp.program_name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 5)
    .slice(0, 2);

  const titleLower = (title || '').toLowerCase();
  const bodyLower = (page.body || '').toLowerCase();
  const titleSignal =
    Boolean(providerToken && titleLower.includes(providerToken)) ||
    programToken.some((t) => titleLower.includes(t));
  const bodySignal = programToken.some((t) => bodyLower.includes(t));

  flags.weak_page_signal = hostOk && (titleSignal || bodySignal);
  flags.program_confirmed = flags.weak_page_signal;

  if ((page.body || '').includes('application/ld+json')) {
    evidence.json_ld_found = true;
    evidence.notes.push('structured_data_present_requires_operator_review');
  }

  flags.benefits_confirmed = false;
  flags.eligibility_confirmed = false;
  flags.application_ready = false;

  const classification = flags.weak_page_signal ? 'WEAK_PAGE_SIGNAL' : 'REACHABLE_ONLY';
  return { flags, evidence, classification };
}

module.exports = { verifyOpportunityRecord };