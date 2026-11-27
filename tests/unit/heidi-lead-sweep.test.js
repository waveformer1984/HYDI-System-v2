'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  titleHash,
  parseScoreFromText,
  parseStrictJsonScore,
  collectFromSources,
  runLeadSweep,
  enabled,
  applyRulesScore,
  canRunLlm,
  scoreLeads,
  loadConfig,
  CKAN_SOURCE_IDS,
  llmMax,
  minFreeMb,
} = require('../../heidi-core/jobs/lead-sweep');
const { normalizeCkanRecord, rollupBuilders, scorePermitLead } = require('../../heidi-core/jobs/lead-scoring-rules');

const ROOT = path.resolve(__dirname, '../..');

describe('heidi lead sweep v2', () => {
  const prev = process.env.HEIDI_LEADS_ENABLED;
  afterEach(() => {
    if (prev === undefined) delete process.env.HEIDI_LEADS_ENABLED;
    else process.env.HEIDI_LEADS_ENABLED = prev;
    delete process.env.HEIDI_LEADS_MIN_FREE_MB;
    delete process.env.HEIDI_LEADS_LLM_MAX;
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

  test('parseScoreFromText returns null when missing', () => {
    expect(parseScoreFromText('score 0.82')).toBe(0.82);
    expect(parseScoreFromText('nonsense')).toBe(null);
  });

  test('parseStrictJsonScore', () => {
    expect(parseStrictJsonScore('{"score":0.72,"reasons":["fit"]}')).toEqual({
      score: 0.72,
      score_reasons: ['fit'],
    });
    expect(parseStrictJsonScore('not json')).toBe(null);
  });

  test('permit types score with rules and score_reasons', () => {
    const record = normalizeCkanRecord(
      {
        permit_number: 'T-1',
        permit_type: 'New Single Family',
        work_description: 'Final clean before CO',
        contractor_name: 'Test Builder',
        site_address: 'San Antonio, TX',
      },
      'sanantonio-permits-ckan',
    );
    const ruled = scorePermitLead(record);
    expect(ruled.scored_by).toBe('rules');
    expect(ruled.score).toBeGreaterThan(0.5);
    expect(ruled.score_reasons).toEqual(
      expect.arrayContaining(['new_residential_or_occupancy_permit']),
    );
    expect(CKAN_SOURCE_IDS.has('sanantonio-permits-ckan')).toBe(true);
  });

  test('builder roll-up in digest path', () => {
    const leads = [
      { contractor: 'Alamo Ranch Builders LLC', score: 0.8 },
      { contractor: 'Alamo Ranch Builders LLC', score: 0.6 },
      { contractor: 'Stone Oak GC Inc', score: 0.7 },
    ];
    const roll = rollupBuilders(leads);
    expect(roll[0].name).toBe('Alamo Ranch Builders LLC');
    expect(roll[0].count).toBe(2);
    expect(roll[0].avg_score).toBeCloseTo(0.7, 2);
  });

  test('bad LLM leaves score null not zero', async () => {
    const leads = [
      {
        source: 'sa-bid',
        title: 'Bid listing',
        url: 'https://example.com/bid/1',
        snippet: 'cleaning',
        title_hash: titleHash('Bid listing'),
      },
    ];
    const out = await scoreLeads(leads, {
      fetch: async () => ({ ok: true, json: async () => ({ response: 'garbage' }) }),
      model: 'local-test',
    });
    expect(out[0].score).toBe(null);
    expect(out[0].scored_by).toBe(null);
    expect(out[0].score_reasons).toContain('llm_failed');
  });

  test('low memory skips LLM', async () => {
    const prevMin = process.env.HEIDI_LEADS_MIN_FREE_MB;
    process.env.HEIDI_LEADS_MIN_FREE_MB = String(10 ** 9);
    expect(canRunLlm()).toBe(false);

    const leads = [
      {
        source: 'sa-bid',
        title: 'Bid',
        url: 'https://example.com/bid/2',
        snippet: '',
        title_hash: titleHash('Bid'),
      },
    ];
    const fetch = jest.fn();
    const out = await scoreLeads(leads, { fetch, model: 'm' });
    expect(fetch).not.toHaveBeenCalled();
    expect(out[0].score_reasons).toContain('llm_skipped_low_memory');
    if (prevMin === undefined) delete process.env.HEIDI_LEADS_MIN_FREE_MB;
    else process.env.HEIDI_LEADS_MIN_FREE_MB = prevMin;
  });

  test('LLM cap enforced', async () => {
    process.env.HEIDI_LEADS_LLM_MAX = '2';
    const { scoreLeads: scoreFresh } = require('../../heidi-core/jobs/lead-sweep');
    const leads = Array.from({ length: 5 }, (_, i) => ({
      source: 'sa-bid',
      title: `Bid ${i}`,
      url: `https://example.com/bid/${i}`,
      snippet: 'clean',
      title_hash: titleHash(`Bid ${i}`),
    }));
    let calls = 0;
    const out = await scoreFresh(leads, {
      fetch: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ response: '{"score":0.55,"reasons":["ok"]}' }) };
      },
      model: 'local-test',
    });
    expect(calls).toBe(2);
    const capped = out.filter((l) => l.score_reasons.includes('llm_cap_reached'));
    expect(capped.length).toBe(3);
    expect(llmMax()).toBe(2);
    expect(minFreeMb()).toBeGreaterThan(0);
  });

  test('collectFromSources uses fixtures without network', async () => {
    const config = loadConfig(ROOT);
    const mockFetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ response: '{"score":0.88,"reasons":["bid_fit"]}' }),
    }));
    const leads = await collectFromSources(config, ROOT, { fetch: mockFetch, model: 'local-test' });
    expect(leads.length).toBeGreaterThanOrEqual(4);
    const permit = leads.find((l) => l.source === 'sanantonio-permits-ckan');
    expect(permit.scored_by).toBe('rules');
    expect(permit.score_reasons.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('runLeadSweep writes digest with builder section', async () => {
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
    fs.cpSync(path.join(ROOT, 'config', 'heidi-leads.json'), path.join(tmp, 'config', 'heidi-leads.json'));
    fs.cpSync(path.join(ROOT, 'tests/fixtures/heidi-leads'), path.join(tmp, 'tests/fixtures/heidi-leads'), {
      recursive: true,
    });
    const r = await runLeadSweep({
      store,
      repoRoot: tmp,
      fetch: async () => ({ ok: true, json: async () => ({ response: '{"score":0.77,"reasons":["bid"]}' }) }),
      model: 'local-test',
    });
    const body = fs.readFileSync(r.mdPath, 'utf8');
    expect(body).toMatch(/Top builders/);
    expect(r.top.length).toBeGreaterThan(0);
    expect(r.builders.length).toBeGreaterThan(0);
  });

  test('128 leads under 60s with mocked LLM', async () => {
    const leads = Array.from({ length: 128 }, (_, i) => ({
      source: i % 2 === 0 ? 'sa-bid' : 'sanantonio-permits-ckan',
      title: i % 2 === 0 ? `Bid item ${i}` : `New Single Family permit ${i}`,
      url: `https://example.com/x/${i}`,
      snippet: i % 2 === 0 ? 'cleaning' : 'final clean new home San Antonio',
      location: 'San Antonio, TX',
      permit_type: i % 2 === 0 ? null : 'New Single Family',
      title_hash: titleHash(`item-${i}`),
    }));
    process.env.HEIDI_LEADS_LLM_MAX = '20';
    const t0 = Date.now();
    const { scoreLeads: scoreFresh } = require('../../heidi-core/jobs/lead-sweep');
    const out = await scoreFresh(leads, {
      fetch: async () => ({
        ok: true,
        json: async () => ({ response: '{"score":0.6,"reasons":["mock"]}' }),
      }),
      model: 'local-test',
    });
    const elapsed = Date.now() - t0;
    expect(out.length).toBe(128);
    expect(elapsed).toBeLessThan(60_000);
    const rulesScored = out.filter((l) => l.scored_by === 'rules');
    expect(rulesScored.length).toBe(64);
  });

  test('applyRulesScore sa-bid stays unscored until LLM', () => {
    const r = applyRulesScore({
      source: 'sa-bid',
      title: 'x',
      snippet: '',
    });
    expect(r.score).toBe(null);
    expect(r.scored_by).toBe(null);
  });
});