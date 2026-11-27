'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMigration } = require('./helpers');
const { importPack, parseLeadsCsv, readPackFiles } = require('../../lib/importPack');

const SQL = readMigration('20261127203000_lf_packs_crm.sql');

describe('Migration 20261127203000 — lf_packs CRM', () => {
  it('creates lf_packs, lf_leads, lf_activities with service_role RLS', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.lf_packs/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.lf_leads/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.lf_activities/);
    expect(SQL).toMatch(/delivery_status.*DEFAULT 'awaiting_jordan_approval'/);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/lf_packs_service_role/);
    expect(SQL).toMatch(/lf_leads_service_role/);
    expect(SQL).toMatch(/lf_activities_service_role/);
    expect(SQL).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.lf_packs TO service_role/);
  });

  it('defines lf_lead status and lf_activity kind constraints', () => {
    expect(SQL).toMatch(/'new', 'reviewed', 'approved', 'contacted', 'replied', 'won', 'lost', 'do_not_contact'/);
    expect(SQL).toMatch(/kind.*CHECK \(kind IN \('note', 'status_change', 'draft_edit', 'suppressed'\)/);
    expect(SQL).toMatch(/REFERENCES public\.lf_packs \(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/REFERENCES public\.lf_leads \(id\) ON DELETE CASCADE/);
  });

  it('documents reversible DOWN rollback', () => {
    expect(SQL).toMatch(/-- DOWN \(manual rollback/);
    expect(SQL).toMatch(/DROP TABLE IF EXISTS public\.lf_activities/);
    expect(SQL).toMatch(/DROP TABLE IF EXISTS public\.lf_leads/);
    expect(SQL).toMatch(/DROP TABLE IF EXISTS public\.lf_packs/);
  });
});

describe('importPack', () => {
  function makeRecordingPool() {
    const calls = [];
    const client = {
      query: jest.fn(async (sql, params) => {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (/^COMMIT/i.test(String(sql).trim())) return { rows: [] };
        if (/^ROLLBACK/i.test(String(sql).trim())) return { rows: [] };
        return { rows: [{ id: params && params[0] }] };
      }),
      release: jest.fn(),
    };
    return {
      calls,
      pool: { connect: jest.fn(async () => client), client },
    };
  }

  function writeFixturePack(root, packId) {
    const dir = path.join(root, packId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      id: packId,
      created_at: '2026-11-27T12:00:00.000Z',
      request: { niche: 'agency-buyers', city: 'Austin, TX', radius: 25, count: 2 },
      leads: 1,
      source_errors: ['OpenStreetMap: timeout'],
      delivery_status: 'awaiting_jordan_approval',
      board_notified: false,
    }, null, 2));
    fs.writeFileSync(path.join(dir, 'leads.json'), '{}');
    fs.writeFileSync(path.join(dir, 'leads.csv'), [
      'business_name,category,address,phone,website,public_business_email,rating,review_count,signals_found,fit_score,fit_reasons,email_1_draft,email_2_draft,email_3_draft',
      '"Lift Local Media","marketing","Austin, TX","2105550200","https://liftlocal.example","hello@liftlocal.example","4.6","48","has_website;mentions_lead_generation","82","base local-business fit +30;has_website +10","Subject: One","","',
    ].join('\n'));
  }

  it('parses leads.csv columns from a fixture pack directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-pack-fixture-'));
    try {
      writeFixturePack(root, 'fixture-import-pack');
      const { leads } = readPackFiles('fixture-import-pack', root);
      expect(leads).toHaveLength(1);
      expect(leads[0].business_name).toBe('Lift Local Media');
      expect(leads[0].signals).toEqual(expect.arrayContaining(['has_website', 'mentions_lead_generation']));
      expect(leads[0].fit_score).toBe(82);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('imports manifest + csv idempotently on pack id (replace leads)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-pack-import-'));
    const { pool, calls } = makeRecordingPool();
    writeFixturePack(root, 'fixture-import-pack');
    try {
      const first = await importPack('fixture-import-pack', { pool, packRoot: root });
      const second = await importPack('fixture-import-pack', { pool, packRoot: root });
      expect(first).toEqual({ packId: 'fixture-import-pack', leadCount: 1, replaced: true });
      expect(second).toEqual({ packId: 'fixture-import-pack', leadCount: 1, replaced: true });
      expect(pool.connect).toHaveBeenCalledTimes(2);
      const packUpserts = calls.filter((c) => c.sql.includes('INSERT INTO lf_packs') && c.sql.includes('ON CONFLICT'));
      const leadDeletes = calls.filter((c) => c.sql.includes('DELETE FROM lf_leads'));
      const leadInserts = calls.filter((c) => c.sql.includes('INSERT INTO lf_leads'));
      expect(packUpserts).toHaveLength(2);
      expect(leadDeletes).toHaveLength(2);
      expect(leadInserts).toHaveLength(2);
      expect(packUpserts[0].params[0]).toBe('fixture-import-pack');
      expect(packUpserts[0].params[1]).toBe('agency-buyers');
      expect(packUpserts[0].params[6]).toBe(JSON.stringify(['OpenStreetMap: timeout']));
      expect(leadInserts[0].params[1]).toBe('Lift Local Media');
      expect(calls.some((c) => /^COMMIT/i.test(c.sql))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('parseLeadsCsv handles quoted commas and empty drafts', () => {
    const csv = parseLeadsCsv([
      'business_name,category,address,phone,website,public_business_email,rating,review_count,signals_found,fit_score,fit_reasons,email_1_draft,email_2_draft,email_3_draft',
      '"Acme, LLC","hvac","Austin","","","","","","","70","reason one","",""',
    ].join('\n'));
    expect(csv).toHaveLength(1);
    expect(csv[0].business_name).toBe('Acme, LLC');
    expect(csv[0].fit_score).toBe(70);
    expect(csv[0].fit_reasons).toEqual(['reason one']);
  });
});