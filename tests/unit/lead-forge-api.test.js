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
});