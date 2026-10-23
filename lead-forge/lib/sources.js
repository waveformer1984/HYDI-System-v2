'use strict';

const dns = require('dns').promises;
const net = require('net');
const { normalizeDomain } = require('./leads');

const USER_AGENT = 'HYDI-Lead-Forge/1.0 (+https://github.com/waveformer1984/HYDI-System-v2)';

async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function escapeOverpass(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function overpassQuery(config, city, radiusMiles, limit) {
  const cityName = String(city).split(',')[0].trim();
  const radiusMeters = Math.max(1, radiusMiles) * 1609.344;
  const selectors = (config.osm_tags || []).map(([key, value]) =>
    `nwr(around.cities:${Math.round(radiusMeters)})["${escapeOverpass(key)}"="${escapeOverpass(value)}"];`).join('');
  return `[out:json][timeout:30];node["place"~"city|town"]["name"="${escapeOverpass(cityName)}"]->.cities;(${selectors});out center tags ${Math.max(limit * 3, 25)};`;
}

function osmAddress(tags) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [street, tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ');
}

async function searchOverpass({ config, city, radiusMiles, limit, fetchFn = globalThis.fetch }) {
  const query = overpassQuery(config, city, radiusMiles, limit);
  const response = await fetchWithTimeout(fetchFn, `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  }, 45_000);
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
  const payload = await response.json();
  return (payload.elements || []).map((element) => {
    const tags = element.tags || {};
    return {
      name: String(tags.name || '').trim(),
      category: tags.craft || tags.shop || tags.amenity || tags.healthcare || tags.office || 'business',
      address: osmAddress(tags),
      phone: tags['contact:phone'] || tags.phone || '',
      website: tags['contact:website'] || tags.website || '',
      email: tags['contact:email'] || tags.email || '',
      rating: null,
      reviewCount: null,
      businessStatus: '',
      sources: [`https://www.openstreetmap.org/${element.type}/${element.id}`],
    };
  }).filter((lead) => lead.name);
}

async function searchGooglePlaces({ config, city, radiusMiles, limit, apiKey = process.env.GOOGLE_PLACES_API_KEY, fetchFn = globalThis.fetch }) {
  if (!apiKey) return [];
  const endpoint = 'https://places.googleapis.com/v1/places:searchText';
  const baseHeaders = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
  };
  const cityResponse = await fetchWithTimeout(fetchFn, endpoint, {
    method: 'POST',
    headers: { ...baseHeaders, 'X-Goog-FieldMask': 'places.location' },
    body: JSON.stringify({ textQuery: city, maxResultCount: 1 }),
  });
  if (!cityResponse.ok) throw new Error(`Google Places city lookup returned ${cityResponse.status}`);
  const cityPayload = await cityResponse.json();
  const center = cityPayload.places && cityPayload.places[0] && cityPayload.places[0].location;
  if (!center || !Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) {
    throw new Error('Google Places could not locate the requested city');
  }
  const leads = [];
  for (const term of config.search_terms) {
    if (leads.length >= limit) break;
    const response = await fetchWithTimeout(fetchFn, endpoint, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'X-Goog-FieldMask': 'places.displayName,places.primaryType,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.googleMapsUri,places.location',
      },
      body: JSON.stringify({
        textQuery: `${term} in ${city}`,
        maxResultCount: Math.min(20, limit - leads.length),
        locationBias: {
          circle: {
            center,
            radius: Math.min(radiusMiles * 1609.344, 50_000),
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Google Places returned ${response.status}`);
    const payload = await response.json();
    for (const place of payload.places || []) {
      if (!place.location || distanceMiles(center, place.location) > radiusMiles) continue;
      leads.push({
        name: place.displayName && place.displayName.text,
        category: place.primaryType || config.business_categories[0],
        address: place.formattedAddress || '',
        phone: place.nationalPhoneNumber || '',
        website: place.websiteUri || '',
        email: '',
        rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? null,
        businessStatus: place.businessStatus || '',
        sources: [place.googleMapsUri || 'Google Places API'],
      });
    }
  }
  return leads.filter((lead) => lead.name).slice(0, limit);
}

function distanceMiles(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(second.latitude - first.latitude);
  const dLon = radians(second.longitude - first.longitude);
  const lat1 = radians(first.latitude);
  const lat2 = radians(second.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
  }
  return true;
}

async function assertPublicWebsite(url, resolveHost = (host) => dns.lookup(host, { all: true })) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('unsupported website URL');
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('private website URL');
  const addresses = await resolveHost(hostname);
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('website did not resolve to a public address');
  }
  return parsed;
}

function robotsAllows(content, pathname, userAgent = 'HYDI-Lead-Forge') {
  const groups = [];
  let current = null;
  for (const raw of String(content || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const split = line.indexOf(':');
    if (split < 0) continue;
    const field = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (field === 'user-agent') {
      current = { agents: [value.toLowerCase()], rules: [] };
      groups.push(current);
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const agent = userAgent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((value) => value !== '*' && agent.includes(value)));
  const applicable = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
  let winner = null;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!rule.path) continue;
      const anchored = rule.path.endsWith('$');
      const source = rule.path.replace(/\$$/, '').split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      if (!(new RegExp(`^${source}${anchored ? '$' : ''}`)).test(pathname)) continue;
      const specificity = rule.path.replace(/[*$]/g, '').length;
      if (!winner || specificity > winner.specificity || (specificity === winner.specificity && rule.allow)) {
        winner = { ...rule, specificity };
      }
    }
  }
  return !winner || winner.allow;
}

function extractContactUrl(html, homeUrl) {
  const home = new URL(homeUrl);
  const links = [...String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi)];
  for (const match of links) {
    try {
      const candidate = new URL(match[1], home);
      if (candidate.origin === home.origin && /(^|\/)(contact|contact-us)\/?$/i.test(candidate.pathname.replace(/\/+$/, ''))) return candidate.href;
    } catch { /* ignore malformed links */ }
  }
  return null;
}

function pageFacts(html) {
  const source = String(html || '');
  const text = source.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const emails = [...source.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)]
    .map((match) => match[0].toLowerCase())
    .filter((email) => !/\.(png|jpg|jpeg|gif|svg)$/i.test(email));
  return {
    text: text.slice(0, 50_000),
    email: emails[0] || '',
    hasOnlineBooking: /\b(book|schedule|reserve)\s+(now|online|an appointment|a table)\b/i.test(text),
  };
}

class DomainThrottle {
  constructor({ intervalMs = 1000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
    this.intervalMs = intervalMs;
    this.sleep = sleep;
    this.now = now;
    this.last = new Map();
  }

  async wait(hostname) {
    const delay = this.intervalMs - (this.now() - (this.last.get(hostname) || 0));
    if (delay > 0) await this.sleep(delay);
    this.last.set(hostname, this.now());
  }
}

async function crawlWebsite(website, {
  fetchFn = globalThis.fetch,
  resolveHost,
  throttle = new DomainThrottle(),
} = {}) {
  const home = await assertPublicWebsite(website, resolveHost);
  const request = async (url) => {
    let current = new URL(url);
    let response;
    for (let redirect = 0; redirect < 4; redirect += 1) {
      current = await assertPublicWebsite(current.href, resolveHost);
      await throttle.wait(current.hostname);
      response = await fetchWithTimeout(fetchFn, current.href, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain' },
        redirect: 'manual',
      }, 15_000);
      if (response.status < 300 || response.status >= 400 || !response.headers || !response.headers.get('location')) break;
      current = new URL(response.headers.get('location'), current);
    }
    if (!response.ok) return '';
    return (await response.text()).slice(0, 500_000);
  };
  const robotsUrl = `${home.origin}/robots.txt`;
  let robots = '';
  try { robots = await request(robotsUrl); } catch { robots = ''; }
  if (!robotsAllows(robots, home.pathname || '/')) return { blockedByRobots: true };
  const homepage = await request(home.href);
  const contactUrl = extractContactUrl(homepage, home.href);
  let contact = '';
  if (contactUrl && robotsAllows(robots, new URL(contactUrl).pathname)) contact = await request(contactUrl);
  const facts = pageFacts(`${homepage}\n${contact}`);
  return { ...facts, blockedByRobots: false, pagesFetched: [home.href, ...(contact ? [contactUrl] : [])] };
}

module.exports = {
  DomainThrottle,
  assertPublicWebsite,
  crawlWebsite,
  distanceMiles,
  extractContactUrl,
  fetchWithTimeout,
  overpassQuery,
  pageFacts,
  robotsAllows,
  searchGooglePlaces,
  searchOverpass,
  normalizeDomain,
};
