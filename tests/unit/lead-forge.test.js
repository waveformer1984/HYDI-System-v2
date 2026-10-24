'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { listNiches, loadNiche } = require('../../lead-forge/lib/config');
const { dedupeLeads, isSuppressed, loadSuppression, scoreLead } = require('../../lead-forge/lib/leads');
const { crawlWebsite, searchGooglePlaces } = require('../../lead-forge/lib/sources');
const { buildLeadPack } = require('../../lead-forge/lib/pack');
const { outreachDrafts } = require('../../lead-forge/lib/delivery');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'lead-forge');

function response({ status = 200, text = '', location = null } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'location' ? location : null) },
    text: async () => text,
  };
}

describe('Lead Forge', () => {
  it('loads every file-defined niche without code registration', () => {
    const ids = listNiches().map((config) => config.id);
    expect(ids).toEqual(expect.arrayContaining([
      'auto-detailing', 'hvac', 'roofing', 'med-spa', 'dental', 'real-estate', 'restaurants',
    ]));
    expect(loadNiche('hvac')).toMatchObject({
      search_terms: expect.any(Array),
      business_categories: expect.any(Array),
      qualifying_signals: expect.any(Array),
      disqualifiers: expect.any(Array),
      why_theyd_buy: expect.any(String),
    });
  });

  it('deduplicates by domain or normalized phone and keeps richer fields', () => {
    const leads = dedupeLeads([
      { name: 'One', website: 'https://www.example.com', phone: '(210) 555-0100', sources: ['osm'] },
      { name: 'One LLC', website: 'https://example.com/contact', email: 'hello@example.com', sources: ['google'] },
      { name: 'Phone Match', phone: '210-555-0100', address: 'San Antonio', sources: ['other'] },
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe('hello@example.com');
    expect(leads[0].sources).toEqual(expect.arrayContaining(['osm', 'google', 'other']));
  });

  it('scores from configured signals with bounded reasons', () => {
    const scored = scoreLead({
      name: 'Alamo Air',
      website: 'https://alamo.example',
      email: 'service@alamo.example',
      phone: '2105550100',
      reviewCount: 42,
      rating: 4.5,
      hasOnlineBooking: false,
      websiteText: '24 hour emergency service',
    }, loadNiche('hvac'));
    expect(scored.fitScore).toBeGreaterThan(30);
    expect(scored.fitScore).toBeLessThanOrEqual(100);
    expect(scored.signals).toEqual(expect.arrayContaining(['has_website', 'no_online_booking', 'has_public_email']));
    expect(scored.fitReasons.length).toBeGreaterThan(1);
  });

  it('excludes every matching suppression identity', () => {
    const suppression = loadSuppression([
      'domain,phone,business_name',
      'blocked.example,,',
      ',2105550199,',
      ',,Never Contact LLC',
    ].join('\n'));
    expect(isSuppressed({ website: 'https://www.blocked.example/' }, suppression)).toBe(true);
    expect(isSuppressed({ phone: '(210) 555-0199' }, suppression)).toBe(true);
    expect(isSuppressed({ name: 'Never Contact LLC' }, suppression)).toBe(true);
    expect(isSuppressed({ name: 'Allowed LLC' }, suppression)).toBe(false);
  });

  it('checks robots.txt and makes no page request when crawling is disallowed', async () => {
    const calls = [];
    const robots = fs.readFileSync(path.join(FIXTURES, 'robots-disallow.txt'), 'utf8');
    const result = await crawlWebsite('https://blocked.example/', {
      resolveHost: async () => [{ address: '93.184.216.34' }],
      throttle: { wait: async () => {} },
      fetchFn: async (url) => {
        calls.push(url);
        return response({ text: robots });
      },
    });
    expect(result).toEqual({ blockedByRobots: true });
    expect(calls).toEqual(['https://blocked.example/robots.txt']);
  });

  it('keeps Google Places completely off when its key is unset', async () => {
    const fetchFn = jest.fn();
    await expect(searchGooglePlaces({
      config: loadNiche('hvac'),
      city: 'San Antonio, TX',
      radiusMiles: 25,
      limit: 10,
      apiKey: '',
      fetchFn,
    })).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches only robots, the homepage, and one same-origin contact page', async () => {
    const calls = [];
    const home = fs.readFileSync(path.join(FIXTURES, 'home.html'), 'utf8');
    const contact = fs.readFileSync(path.join(FIXTURES, 'contact.html'), 'utf8');
    const result = await crawlWebsite('https://alamo-air.example/', {
      resolveHost: async () => [{ address: '93.184.216.34' }],
      throttle: { wait: async () => {} },
      fetchFn: async (url) => {
        calls.push(url);
        if (url.endsWith('/robots.txt')) return response({ text: 'User-agent: *\nAllow: /' });
        if (url.endsWith('/contact')) return response({ text: contact });
        return response({ text: home });
      },
    });
    expect(calls).toEqual([
      'https://alamo-air.example/robots.txt',
      'https://alamo-air.example/',
      'https://alamo-air.example/contact',
    ]);
    expect(result.email).toBe('service@alamo-air.example');
    expect(result.pagesFetched).toHaveLength(2);
  });

  it('writes CSV/PDF delivery artifacts and posts only an approval notice', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-forge-'));
    const board = { post: jest.fn(async () => ({ ok: true })) };
    try {
      const pack = await buildLeadPack({
        niche: 'hvac', city: 'San Antonio, TX', radius: 25, count: 5, id: 'test-pack',
      }, {
        outputRoot,
        suppressionPath: path.join(outputRoot, 'none.csv'),
        searchGooglePlaces: async () => [],
        searchOverpass: async () => [{
          name: 'Alamo Air', category: 'hvac', address: 'San Antonio, TX',
          phone: '2105550100', website: 'https://alamo-air.example', email: '',
          rating: 4.5, reviewCount: 42, sources: ['fixture'],
        }],
        crawlWebsite: async () => ({
          email: 'service@alamo-air.example',
          text: 'emergency service',
          hasOnlineBooking: false,
          blockedByRobots: false,
        }),
        board,
        googleApiKey: '',
      });
      expect(fs.readFileSync(pack.csvPath, 'utf8')).toContain('Alamo Air');
      expect(fs.readFileSync(pack.pdfPath).subarray(0, 8).toString()).toBe('%PDF-1.4');
      expect(board.post).toHaveBeenCalledWith(
        'ops',
        expect.stringContaining("needs Jordan's approval before delivery or outreach"),
        null,
        { sender: 'ProtoForge' },
      );
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('makes optional drafts email-only and includes CAN-SPAM footer text', () => {
    const drafts = outreachDrafts(
      { name: 'Alamo Air', signals: ['no_online_booking'] },
      loadNiche('hvac'),
      '123 Main St, San Antonio, TX 78205',
    );
    for (const draft of Object.values(drafts)) {
      expect(draft).toContain('123 Main St, San Antonio, TX 78205');
      expect(draft).toContain('Reply "opt out"');
    }
    expect(JSON.stringify(drafts)).not.toMatch(/\bSMS\b|\btext message\b|\bcall you\b/i);
  });

  it('turns the phone command into a board request instead of executing a pack', () => {
    const script = [
      'import hydi',
      'hydi._file_action_request = lambda value: value',
      'print(hydi._handle_command("lead pack hvac San Antonio, TX 50"))',
    ].join('; ');
    const output = execFileSync('python3', ['-c', script], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
    expect(output).toContain('build lead pack');
    expect(output).toContain('San Antonio, TX');
    expect(output).toContain('review-only, no delivery or outreach');
  });
});
