'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('job-scout pool mission', () => {
  it('enqueues scout+research subtasks for detailer prospects', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-pool-'));
    const env = { ...process.env, JOB_SCOUT_DIR: dir };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'leads.json'),
      JSON.stringify({
        leads: [
          { title: 'Detailer needed', division: 'detailer', url: 'https://example.com/job/1' },
        ],
      }),
    );
    const { enqueueJobScoutPoolMission } = require('../../lib/job-scout/pool-mission');
    const r = await enqueueJobScoutPoolMission({ env });
    expect(r.ok).toBe(true);
    expect(r.subtasks_enqueued).toBeGreaterThan(0);
    expect(r.wall_clock_ms).toBeGreaterThanOrEqual(0);
    expect(r.note).toMatch(/never auto-QUALIFY/i);
  });
});