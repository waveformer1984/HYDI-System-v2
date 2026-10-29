const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCopilot } = require('../src/copilot');

function fakeRepository({ tracks = [], assets = [], jobs = [] } = {}) {
  return {
    dataDir: os.tmpdir(),
    getProject: async (id) => ({ id }),
    listTracks: async () => tracks,
    listAssets: async () => assets,
    listProcessingJobs: async () => jobs,
  };
}

describe('Rezonate Co-Pilot', () => {
  it('suggests stem splitting for a track without stems', async () => {
    const cp = createCopilot({
      repository: fakeRepository({ tracks: [{ id: 't1', title: 'song', source_path: 'C:/a/song.wav' }] }),
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cop-')),
    });
    const { suggestions } = await cp.suggest('p1');
    assert.ok(suggestions.some((s) => s.kind === 'stems' && s.action.task_type === 'stems'));
  });

  it('suggests segment swaps for a track with stems, as applyable jobs', async () => {
    const cp = createCopilot({
      repository: fakeRepository({
        tracks: [{ id: 't1', title: 'song', stems_dir: 'C:/stems/song', bpm: 120 }],
      }),
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cop-')),
    });
    const { suggestions } = await cp.suggest('p1');
    const swaps = suggestions.filter((s) => s.kind === 'segment_swap');
    assert.ok(swaps.length >= 1);
    assert.equal(swaps[0].action.task_type, 'segment_swap');
    assert.equal(swaps[0].action.metadata.stemsDir, 'C:/stems/song');
    assert.equal(swaps[0].action.metadata.bpm, 120);
  });

  it('flags a failed job as the next action', async () => {
    const cp = createCopilot({
      repository: fakeRepository({
        tracks: [{ id: 't1', stems_dir: 'x' }],
        jobs: [{ id: 'abcdef123', state: 'failed', error: 'boom', created_at: '2026-10-28T00:00:00Z' }],
      }),
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cop-')),
    });
    const { suggestions } = await cp.suggest('p1');
    assert.ok(suggestions.some((s) => s.kind === 'next' && /abcdef12|failed/i.test(s.detail)));
  });

  it('persists session notes per project and recalls them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cop-'));
    const cp = createCopilot({ repository: fakeRepository(), dataDir: dir });
    await cp.remember('p1', 'keep drums busier');
    await cp.remember('p1', 'try G maj variant');
    const { entries } = await cp.memory('p1');
    assert.equal(entries.length, 2);
    assert.match(entries[1].note, /G maj/);
    const other = await cp.memory('p2');
    assert.equal(other.entries.length, 0);
  });

  it('never applies operations itself — suggestions only carry payloads', async () => {
    const cp = createCopilot({ repository: fakeRepository(), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cop-')) });
    const { suggestions } = await cp.suggest(null);
    for (const s of suggestions) {
      if (s.action) assert.ok(s.action.task_type);
    }
  });
});
