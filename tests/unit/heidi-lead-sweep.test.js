'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  titleHash,
  parseScoreFromText,
  collectFromSources,
  runLeadSweep,
  enabled,
} = require('../../heidi-core/jobs/lead-sweep');

const ROOT = path.resolve(__dirname, '../..');

describe('heidi lead sweep', () => {
  const prev = process.env.HEIDI_LEADS_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.HEIDI_LEADS_ENABLED;
    else process.env.HEIDI_LEADS_ENABLED = prev;
  });

  test('enabled flag default false', () => {
    delete process.env.HEIDI_LEADS_ENABLED;
    expect(enabled()).toBe(false);
    process.env.HEIDI_LEADS_ENABLED = 'true';
    expect(enabled()).toBe(true);
  });

  test('titleHash stable', () => {
    expect(titleHash('Final clean')).toBe(titleHash('Final clean'));
    expect(titleHash('Final clean')).not.toBe(titleHash('Other'));
  });

  test('parseScoreFromText', () => {
    expect(parseScoreFromText('score 0.82')).toBe(0.82);
    expect(parseScoreFromText('nonsense')).toBe(0);
  });

  test('collectFromSources uses fixture without network', async () => {
    const config = {
      sources: [{ id: 'fixture', type: 'fixture', enabled: true, fixture: 'tests/fixtures/heidi-leads/sample-listing.json' }],
    };
    const leads = await collectFromSources(config, ROOT, {
      fetch: async () => ({ ok: true, json: async () => ({ response: '0.9' }) }),
    });
    expect(leads.length).toBe(2);
    expect(leads[0].title_hash).toHaveLength(32);
    expect(leads[0].score).toBeGreaterThan(0);
  });

  test('runLeadSweep writes markdown digest', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-digest-'));
    const store = {
      isAvailable: () => true,
      from(table) {
        if (table === 'heidi_leads') {
          return { upsert: async () => ({ error: null }) };
        }
        if (table === 'heidi_events') {
          return { insert: async () => ({ error: null }) };
        }
        throw new Error(`unexpected ${table}`);
      },
    };
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tests/fixtures/heidi-leads'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'config', 'heidi-leads.json'), path.join(tmp, 'config', 'heidi-leads.json'));
    fs.copyFileSync(
      path.join(ROOT, 'tests/fixtures/heidi-leads/sample-listing.json'),
      path.join(tmp, 'tests/fixtures/heidi-leads/sample-listing.json'),
    );
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'heidi-leads.json'), 'utf8'));
    fs.writeFileSync(path.join(tmp, 'config', 'heidi-leads.json'), JSON.stringify(cfg));
    const r = await runLeadSweep({
      store,
      repoRoot: tmp,
      fetch: async () => ({ ok: true, json: async () => ({ response: '0.75' }) }),
    });
    expect(fs.existsSync(r.mdPath)).toBe(true);
    expect(r.top.length).toBeGreaterThan(0);
  });
});