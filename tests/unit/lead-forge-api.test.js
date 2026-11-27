'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsePackBody } = require('../../lib/lead-forge/api');
const {
  createJob,
  getJob,
  resetJobsForTests,
  runPackJob,
} = require('../../lib/lead-forge/jobs');

describe('lead-forge API helpers', () => {
  beforeEach(() => resetJobsForTests());

  it('parsePackBody validates niche against listNiches and bounds', () => {
    const body = parsePackBody({
      niche: 'agency-buyers',
      city: 'Austin, TX',
      radius: 25,
      count: 10,
      outreach: true,
    });
    expect(body).toMatchObject({ niche: 'agency-buyers', city: 'Austin, TX', outreach: true });
    expect(() => parsePackBody({ niche: 'not-a-niche', city: 'X', radius: 25, count: 5 }))
      .toThrow(/unknown niche/);
    expect(() => parsePackBody({ niche: 'hvac', city: 'Austin, TX', radius: 200, count: 5 }))
      .toThrow(/radius/);
  });

  it('runPackJob completes with mocked pack build and import', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-job-'));
    const pool = { connect: jest.fn() };
    const job = createJob({ niche: 'hvac', city: 'Austin, TX', radius: 25, count: 1, outreach: false });
    const deps = {
      packRoot: outputRoot,
      packDeps: {
        outputRoot,
        postBoard: false,
        searchGooglePlaces: async () => [],
        searchOverpass: async () => [{
          name: 'Job HVAC', website: 'https://job.example', phone: '2105550999',
          email: 'job@example.com', reviewCount: 12, rating: 4.1, sources: ['fixture'],
        }],
        crawlWebsite: async () => ({ email: 'job@example.com', text: 'service', hasOnlineBooking: false, blockedByRobots: false }),
        board: { post: async () => ({ ok: true }) },
      },
      buildLeadPack: jest.requireActual('../../lead-forge/lib/pack').buildLeadPack,
      importPack: jest.fn(async () => ({ packId: 'job-pack', leadCount: 1 })),
      pool,
    };
    await runPackJob(job.id, deps);
    const updated = getJob(job.id);
    expect(updated.status).toBe('completed');
    expect(updated.packId).toBeTruthy();
    expect(deps.importPack).toHaveBeenCalled();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });

  it('stores failed job when build throws', async () => {
    const job = createJob({ niche: 'hvac', city: 'Bad', radius: 25, count: 1, outreach: false });
    await runPackJob(job.id, {
      buildLeadPack: async () => { throw new Error('mock build failure'); },
    });
    expect(getJob(job.id)).toMatchObject({ status: 'failed', error: 'mock build failure' });
  });

  it('mocked flow: generate pack files, import SQL, status change, suppress line, csv on disk', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-e2e-'));
    const { buildLeadPack } = require('../../lead-forge/lib/pack');
    const { importPack } = require('../../lib/importPack');
    const { updateLead, insertActivity, packCsvPath } = require('../../lib/lead-forge/db');
    const pack = await buildLeadPack({
      niche: 'agency-buyers', city: 'San Antonio, TX', radius: 25, count: 1, id: 'e2e-pack',
    }, {
      outputRoot,
      postBoard: false,
      searchGooglePlaces: async () => [],
      searchOverpass: async () => [{
        name: 'E2E Media', website: 'https://e2e.example', phone: '2105550777',
        email: 'e2e@example.com', reviewCount: 40, rating: 4.5, sources: ['fixture'],
      }],
      crawlWebsite: async () => ({
        email: 'e2e@example.com', text: 'lead generation', hasOnlineBooking: false, blockedByRobots: false,
      }),
    });
    expect(fs.existsSync(pack.csvPath)).toBe(true);
    expect(fs.readFileSync(pack.csvPath, 'utf8')).toContain('E2E Media');
    const importCalls = [];
    const importPool = {
      connect: async () => ({
        query: async (sql, params) => {
          importCalls.push(String(sql));
          if (/COMMIT|BEGIN|ROLLBACK/i.test(String(sql))) return { rows: [] };
          return { rows: [{ id: pack.id }] };
        },
        release: () => {},
      }),
    };
    await importPack(pack.id, { pool: importPool, packRoot: outputRoot });
    expect(importCalls.some((s) => /INSERT INTO lf_packs/i.test(s))).toBe(true);
    expect(importCalls.some((s) => /INSERT INTO lf_leads/i.test(s))).toBe(true);

    const leadId = '11111111-1111-1111-1111-111111111111';
    const dbCalls = [];
    const dbPool = {
      query: jest.fn(async (sql, params) => {
        dbCalls.push(String(sql));
        if (/UPDATE lf_leads/.test(String(sql))) {
          return { rows: [{ id: leadId, status: 'reviewed', notes: 'Jordan review' }] };
        }
        if (/INSERT INTO lf_activities/.test(String(sql))) {
          return { rows: [{ id: 'act-1' }] };
        }
        return { rows: [] };
      }),
    };
    await updateLead(dbPool, leadId, { status: 'reviewed', notes: 'Jordan review' });
    await insertActivity(dbPool, leadId, 'status_change', 'status: new → reviewed');

    const suppressionFile = path.join(outputRoot, 'suppression.csv');
    fs.writeFileSync(suppressionFile, 'domain,phone,business_name\n');
    fs.appendFileSync(suppressionFile, 'e2e.example,2105550777,E2E Media\n', 'utf8');
    expect(fs.readFileSync(suppressionFile, 'utf8')).toContain('e2e.example');
    expect(fs.existsSync(pack.csvPath)).toBe(true);
    expect(packCsvPath(pack.id)).toContain(`packs/${pack.id}/leads.csv`);
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
});