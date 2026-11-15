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

/**
 * Automated verification — conservative. HTTP 200 alone never sets benefits_confirmed.
 */
async function verifyOpportunityRecord(opp) {
  const flags = emptyFlags();
  const evidence = {
    verified_at: new Date().toISOString(),
    official_source_url: opp.official_source_url,
    method: 'automated_page_probe',
    http: null,
    title: null,
    meta_description: null,
    json_ld_found: false,
    notes: [],
  };

  if (!opp.official_source_url) {
    evidence.notes.push('missing_official_source_url');
    return { flags, evidence, classification: 'UNVERIFIED' };
  }

  const page = await fetchPageText(opp.official_source_url);
  evidence.http = page.ok
    ? { status: page.status, elapsed_ms: page.elapsed_ms }
    : { error: page.error, status: page.status || null, elapsed_ms: page.elapsed_ms };

  flags.source_reachable = Boolean(page.ok && page.status >= 200 && page.status < 400);

  if (!flags.source_reachable || !page.body) {
    evidence.notes.push('source_not_reachable_or_blocked');
    return { flags, evidence, classification: 'REACHABLE_UNKNOWN' };
  }

  const title = extractTitle(page.body);
  const meta = extractMetaDescription(page.body);
  evidence.title = title;
  evidence.meta_description = meta;

  const provider = String(opp.provider || '').toLowerCase();
  const program = String(opp.program_name || '').toLowerCase();
  const bodyLower = page.body.toLowerCase();

  const hostOk =
    (provider.includes('openai') && hostMatches(opp.official_source_url, ['openai.com', 'webinar.openai.com'])) ||
    (provider.includes('anthropic') && hostMatches(opp.official_source_url, ['anthropic.com', 'claude.com'])) ||
    (provider.includes('github') && hostMatches(opp.official_source_url, ['github.com'])) ||
    hostMatches(opp.official_source_url, ['aws.amazon.com', 'cloud.google.com', 'microsoft.com', 'grants.gov', 'sbir.gov', 'nsf.gov']);

  const titleSignal = title && (title.toLowerCase().includes(provider.split(' ')[0]) || title.toLowerCase().includes('startup') || title.toLowerCase().includes('grant'));
  const programToken = program.split(/[^a-z0-9]+/).filter((t) => t.length > 4).slice(0, 3);
  const bodySignal = programToken.some((t) => bodyLower.includes(t));

  flags.program_confirmed = hostOk && (Boolean(titleSignal) || Boolean(bodySignal));

  if (page.body.includes('application/ld+json')) {
    evidence.json_ld_found = true;
    evidence.notes.push('structured_data_present_requires_manual_review');
  }

  // Benefits never auto-confirmed from HTML alone in v1
  flags.benefits_confirmed = false;
  flags.eligibility_confirmed = false;
  flags.application_ready = false;

  const classification = flags.program_confirmed ? 'PROGRAM_PROBE_CONFIRMED' : 'REACHABLE_ONLY';
  return { flags, evidence, classification };
}

module.exports = { verifyOpportunityRecord };