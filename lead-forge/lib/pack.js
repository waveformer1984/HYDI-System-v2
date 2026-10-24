'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { loadNiche } = require('./config');
const { dedupeLeads, isSuppressed, loadSuppression, scoreLead } = require('./leads');
const { crawlWebsite, searchGooglePlaces, searchOverpass } = require('./sources');
const { ensurePackDirectory, outreachDrafts, writeCsv, writeSummaryPdf } = require('./delivery');

const ROOT = path.join(__dirname, '..');

function packId(niche, now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `${stamp}-${niche}-${randomUUID().slice(0, 8)}`;
}

function validateRequest({ niche, city, radius, count }) {
  if (!niche) throw new Error('niche is required');
  if (typeof city !== 'string' || city.trim().length < 2 || city.length > 120 || /[\r\n]/.test(city)) throw new Error('city is required');
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100) throw new Error('radius must be between 1 and 100 miles');
  if (!Number.isSafeInteger(count) || count < 1 || count > 500) throw new Error('count must be between 1 and 500');
}

async function buildLeadPack(options, deps = {}) {
  const request = {
    niche: options.niche,
    city: options.city,
    radius: Number(options.radius),
    count: Number(options.count),
  };
  validateRequest(request);
  const config = (deps.loadNiche || loadNiche)(request.niche);
  const fetchFn = deps.fetchFn || globalThis.fetch;
  const sourceErrors = [];
  const sourceLimit = Math.min(request.count * 3, 500);
  const sourceArgs = {
    config,
    city: request.city,
    radiusMiles: request.radius,
    limit: sourceLimit,
    fetchFn,
  };
  const [google, overpass] = await Promise.all([
    (deps.searchGooglePlaces || searchGooglePlaces)({ ...sourceArgs, apiKey: deps.googleApiKey ?? process.env.GOOGLE_PLACES_API_KEY })
      .catch((error) => { sourceErrors.push(`Google Places: ${error.message}`); return []; }),
    (deps.searchOverpass || searchOverpass)(sourceArgs)
      .catch((error) => { sourceErrors.push(`OpenStreetMap: ${error.message}`); return []; }),
  ]);

  const suppressionPath = deps.suppressionPath || path.join(ROOT, 'suppression.csv');
  const suppression = loadSuppression(fs.existsSync(suppressionPath) ? fs.readFileSync(suppressionPath, 'utf8') : '');
  const candidates = dedupeLeads([...google, ...overpass]).filter((lead) => !isSuppressed(lead, suppression));
  const enriched = [];
  const vettingPool = candidates.slice(0, Math.min(request.count * 2, 200));
  for (const candidate of vettingPool) {
    let websiteFacts = {};
    if (candidate.website) {
      try {
        websiteFacts = await (deps.crawlWebsite || crawlWebsite)(candidate.website, {
          fetchFn,
          resolveHost: deps.resolveHost,
          throttle: deps.throttle,
        });
      } catch (error) {
        websiteFacts = { crawlError: error.message };
      }
    }
    const scored = scoreLead({
      ...candidate,
      email: candidate.email || websiteFacts.email || '',
      hasOnlineBooking: websiteFacts.hasOnlineBooking,
      websiteText: websiteFacts.text || '',
      robotsBlocked: websiteFacts.blockedByRobots || false,
    }, config);
    if (!scored.disqualifiedBy.length) enriched.push(scored);
  }

  const leads = enriched.sort((a, b) => b.fitScore - a.fitScore || a.name.localeCompare(b.name)).slice(0, request.count);
  if (options.outreach) {
    const senderAddress = deps.senderAddress ?? process.env.LEAD_FORGE_SENDER_ADDRESS;
    for (const lead of leads) Object.assign(lead, outreachDrafts(lead, config, senderAddress));
  }

  const id = options.id || packId(request.niche, deps.now ? deps.now() : new Date());
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('invalid pack id');
  const outputRoot = deps.outputRoot || path.join(ROOT, 'packs');
  fs.mkdirSync(outputRoot, { recursive: true });
  const dir = ensurePackDirectory(outputRoot, id);
  const csvPath = path.join(dir, 'leads.csv');
  const pdfPath = path.join(dir, 'summary.pdf');
  writeCsv(csvPath, leads);
  writeSummaryPdf(pdfPath, {
    niche: request.niche,
    city: request.city,
    radius: request.radius,
    requestedCount: request.count,
    leads,
    angle: config.why_theyd_buy,
    sourceErrors,
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    id,
    created_at: (deps.now ? deps.now() : new Date()).toISOString(),
    request,
    leads: leads.length,
    sources: { google_places_enabled: !!(deps.googleApiKey ?? process.env.GOOGLE_PLACES_API_KEY), openstreetmap_overpass: true },
    source_errors: sourceErrors,
    outreach_drafts: !!options.outreach,
    delivery_status: 'awaiting_jordan_approval',
  }, null, 2));

  if (deps.postBoard !== false) {
    const board = deps.board || require('../../lib/forge-board/sdk');
    const result = await board.post(
      'ops',
      `Lead pack ready: ${request.niche}, ${request.city}, ${leads.length} leads — needs Jordan's approval before delivery or outreach.`,
      null,
      { sender: 'ProtoForge' },
    );
    if (!result || result.ok !== true) throw new Error('lead pack saved, but Forge Board notification failed');
  }
  return { id, dir, csvPath, pdfPath, leads, sourceErrors };
}

module.exports = { buildLeadPack, packId, validateRequest };
