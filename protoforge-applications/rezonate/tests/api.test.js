const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApi } = require('../src/api/router');

describe('Resonate API', () => {
  function listen(app) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, (err) => {
        if (err) return reject(err);
        resolve({ server, port: server.address().port });
      });
    });
  }

  it('creates a project and tracks', async () => {
    const repo = createRepository();
    await repo.init();
    const app = createApi(repo);
    const { server, port } = await listen(app);
    try {
      let res = await fetch(`http://localhost:${port}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Demo', tempo: 128 })
      });
      let data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.ok(data.ok);
      const id = data.project.id;

      res = await fetch(`http://localhost:${port}/projects/${id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bass', type: 'audio' })
      });
      data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.track.name, 'Bass');
    } finally {
      server.close();
    }
  });

  it('creates and transitions a processing job', async () => {
    const repo = createRepository();
    await repo.init();
    const app = createApi(repo);
    const { server, port } = await listen(app);
    try {
      let res = await fetch(`http://localhost:${port}/processing/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: 'stems', source_path: 'track.mp3' })
      });
      let data = await res.json();
      assert.strictEqual(res.status, 201);
      const id = data.job.id;

      res = await fetch(`http://localhost:${port}/processing/jobs/${id}/start`, { method: 'POST' });
      data = await res.json();
      assert.strictEqual(data.job.state, 'stems_processing');

      res = await fetch(`http://localhost:${port}/processing/jobs/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bpm: 120, key: 'C' })
      });
      data = await res.json();
      assert.strictEqual(data.job.state, 'completed');
    } finally {
      server.close();
    }
  });

  it('registers an asset', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Pack' });
    const app = createApi(repo);
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://localhost:${port}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          type: 'vocal',
          file_path: 'vocal.wav',
          bpm: 95,
          key: 'F minor'
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.asset.type, 'vocal');
      assert.strictEqual(data.asset.bpm, 95);
    } finally {
      server.close();
    }
  });
});
