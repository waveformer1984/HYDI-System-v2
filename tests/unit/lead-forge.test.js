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
      'agency-buyers', 'auto-detailing', 'hvac', 'roofing', 'med-spa', 'dental', 'real-estate', 'restaurants',
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

  it('merges duplicate domains inside a pack build while enriching from the richer row', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-forge-dedupe-'));
    try {
      const pack = await buildLeadPack({
        niche: 'hvac', city: 'San Antonio, TX', radius: 25, count: 5, id: 'dedupe-pack',
      }, {
        outputRoot,
        suppressionPath: path.join(outputRoot, 'empty.csv'),
        searchGooglePlaces: async () => [{
          name: 'Primary AC', website: 'https://primary-ac.example', phone: '2105550111', sources: ['google'],
        }],
        searchOverpass: async () => [{
          name: 'Primary AC LLC', website: 'https://www.primary-ac.example/service',
          email: 'sales@primary-ac.example', phone: '2105550111', reviewCount: 30, rating: 4.4, sources: ['osm'],
        }],
        crawlWebsite: async () => ({
          email: 'sales@primary-ac.example', text: 'emergency service', hasOnlineBooking: false, blockedByRobots: false,
        }),
        board: { post: async () => ({ ok: true }) },
        googleApiKey: '',
      });
      expect(pack.leads).toHaveLength(1);
      expect(pack.leads[0].email).toBe('sales@primary-ac.example');
      expect(pack.leads[0].sources).toEqual(expect.arrayContaining(['google', 'osm']));
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('drops closed, no-contact, and suppressed leads from a pack build', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-forge-filter-'));
  const suppressionFile = path.join(outputRoot, 'suppression.csv');
    fs.writeFileSync(suppressionFile, ['domain,phone,business_name', 'blocked.example,,'].join('\n'));
    try {
      const pack = await buildLeadPack({
        niche: 'hvac', city: 'San Antonio, TX', radius: 25, count: 10, id: 'filter-pack',
      }, {
        outputRoot,
        suppressionPath: suppressionFile,
        searchGooglePlaces: async () => [],
        searchOverpass: async () => [
          { name: 'Closed Shop', businessStatus: 'PERMANENTLY_CLOSED', website: 'https://closed.example', phone: '2105550190', sources: ['osm'] },
          { name: 'Ghost LLC', sources: ['osm'] },
          { name: 'Blocked Co', website: 'https://blocked.example/', phone: '2105550191', sources: ['osm'] },
          {
            name: 'Good HVAC', website: 'https://good-hvac.example', phone: '2105550192',
            email: 'ops@good-hvac.example', reviewCount: 28, rating: 4.3, sources: ['osm'],
          },
        ],
        crawlWebsite: async () => ({ email: '', text: 'emergency service', hasOnlineBooking: false, blockedByRobots: false }),
        board: { post: async () => ({ ok: true }) },
        googleApiKey: '',
      });
      expect(pack.leads).toHaveLength(1);
      expect(pack.leads[0].name).toBe('Good HVAC');
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('scores agency-buyers fixtures within the standard bounded range', () => {
    const scored = scoreLead({
      name: 'Lift Local Media',
      website: 'https://liftlocal.example',
      email: 'hello@liftlocal.example',
      phone: '2105550200',
      reviewCount: 48,
      rating: 4.6,
      hasOnlineBooking: false,
      websiteText: 'performance marketing and lead generation for local businesses',
    }, loadNiche('agency-buyers'));
    expect(scored.fitScore).toBeGreaterThan(30);
    expect(scored.fitScore).toBeLessThanOrEqual(100);
    expect(scored.signals).toEqual(expect.arrayContaining(['mentions_lead_generation', 'has_public_email']));
    expect(scored.disqualifiedBy).toEqual([]);
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
      const manifest = JSON.parse(fs.readFileSync(path.join(pack.dir, 'manifest.json'), 'utf8'));
      expect(manifest.board_notified).toBe(true);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('returns the saved pack when Forge Board post fails', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-forge-board-fail-'));
    try {
      const pack = await buildLeadPack({
        niche: 'hvac', city: 'San Antonio, TX', radius: 25, count: 3, id: 'board-fail-pack',
      }, {
        outputRoot,
        suppressionPath: path.join(outputRoot, 'none.csv'),
        searchGooglePlaces: async () => [],
        searchOverpass: async () => [{
          name: 'Board Fail HVAC', website: 'https://bf.example', phone: '2105550300',
          email: 'x@bf.example', reviewCount: 20, rating: 4.2, sources: ['fixture'],
        }],
        crawlWebsite: async () => ({ email: 'x@bf.example', text: 'service', hasOnlineBooking: false, blockedByRobots: false }),
        board: { post: async () => ({ ok: false, error: 'board unavailable' }) },
        googleApiKey: '',
      });
      expect(pack.leads).toHaveLength(1);
      expect(pack.boardWarning).toContain('board unavailable');
      const manifest = JSON.parse(fs.readFileSync(path.join(pack.dir, 'manifest.json'), 'utf8'));
      expect(manifest.board_notified).toBe(false);
      expect(fs.readFileSync(pack.csvPath, 'utf8')).toContain('Board Fail HVAC');
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('CLI prints a board warning without setting a failure exit code', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-forge-cli-'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const priorArgv = process.argv;
    const priorExitCode = process.exitCode;
    process.exitCode = undefined;
    process.argv = ['node', 'build.js', '--niche', 'hvac', '--city', 'Austin, TX', '--count', '1'];
    try {
      await new Promise((resolve, reject) => {
        jest.isolateModules(() => {
          jest.doMock('../../lead-forge/lib/pack', () => ({
            buildLeadPack: async () => ({
              id: 'cli-warning-pack',
              dir: outputRoot,
              csvPath: path.join(outputRoot, 'leads.csv'),
              pdfPath: path.join(outputRoot, 'summary.pdf'),
              leads: [{ name: 'CLI Co' }],
              sourceErrors: [],
              boardWarning: 'board unavailable',
            }),
          }));
          const { main } = require('../../lead-forge/build');
          main().then(resolve).catch(reject);
        });
      });
      expect(warnSpy).toHaveBeenCalledWith('Forge Board warning: board unavailable');
      expect(process.exitCode).toBeFalsy();
    } finally {
      process.argv = priorArgv;
      process.exitCode = priorExitCode;
      warnSpy.mockRestore();
      logSpy.mockRestore();
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
