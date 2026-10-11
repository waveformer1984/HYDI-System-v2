'use strict';

/**
 * Shared Overpass/OpenStreetMap prospect source — plain JS so both the
 * TypeScript adapter (ProspectDiscoveryAdapter.ts) and the CJS resolver
 * layer (human-actions/resolvers.js) can call it under any loader.
 *
 * Queries the public Overpass API for real businesses carrying a public
 * website tag. Only business-listing fields are read (name, website,
 * phone, craft/shop, address) — never private contact data. Every result
 * carries full provenance. Empty regions and provider outages return []
 * honestly; nothing is fabricated to fill a count.
 */

const DEFAULT_REGIONS = [
  { bbox: '(45.4,-122.8,45.7,-122.3)', label: 'Portland OR' },
  { bbox: '(41.7,-87.9,42.1,-87.5)', label: 'Chicago IL' },
  { bbox: '(30.1,-97.9,30.5,-97.5)', label: 'Austin TX' },
];

function buildQuery(bbox, limit) {
  return `[out:json][timeout:20];(nwr["craft"]["website"]${bbox};nwr["craft"]["contact:website"]${bbox};nwr["shop"~"trade|doityourself|electrical|hvac"]["website"]${bbox};);out body ${limit};`;
}

/**
 * @param {object} opts
 * @param {string} [opts.location] — 's,w,n,e' bbox or omitted for defaults
 * @param {number} [opts.limit]
 * @param {Function} [opts.fetchFn] — injectable fetch (tests)
 * @returns {Promise<Array>} DiscoveredProspect-shaped records
 */
async function discoverFromOverpass({ location, limit = 10, fetchFn } = {}) {
  const fetch_ = fetchFn || globalThis.fetch;
  const retrievedAt = new Date().toISOString();
  const regions = location && /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(location)
    ? [{ bbox: `(${location.trim()})`, label: location.trim() }]
    : DEFAULT_REGIONS;

  const discovered = [];
  const seenHosts = new Set();
  for (const region of regions) {
    if (discovered.length >= limit) break;
    const overpass = buildQuery(region.bbox, limit);
    let elements = [];
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      // GET + an identifying User-Agent: the public endpoint rejects
      // bare POSTs from generic agents with 406.
      const res = await fetch_(
        'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(overpass),
        { headers: { 'User-Agent': 'HYDI-ProtoForge/1.0 (+https://github.com/waveformer1984/HYDI-System-v2)' }, signal: ctrl.signal },
      ).finally(() => clearTimeout(t));
      if (!res.ok) continue;
      const data = await res.json();
      elements = data.elements || [];
    } catch { continue; }

    for (const el of elements) {
      if (discovered.length >= limit) break;
      const tags = el.tags || {};
      const name = (tags.name || '').trim();
      const website = (tags['contact:website'] || tags.website || '').trim();
      if (!name || !website || !/^https?:\/\//i.test(website)) continue;
      let host = '';
      try { host = new URL(website).host.replace(/^www\./, ''); } catch { continue; }
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      const craft = tags.craft || tags.shop || 'business';
      discovered.push({
        companyName: name,
        contactName: null,
        contactEmail: null,
        contactPhone: (tags['contact:phone'] || tags.phone || '').trim() || null,
        website,
        industry: craft,
        location: [tags['addr:city'], tags['addr:state']].filter(Boolean).join(', ') || region.label,
        source: 'public_directory',
        sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        discoveryEvidence: {
          provider: 'openstreetmap',
          query: overpass,
          resultCount: elements.length,
          retrievedAt,
          raw: { osmType: el.type, osmId: el.id, name, website, craft, phone: (tags.phone || null) },
        },
        metadata: { region: region.label, osmElement: `${el.type}/${el.id}` },
      });
    }
  }
  return discovered;
}

module.exports = { discoverFromOverpass, buildQuery, DEFAULT_REGIONS };
