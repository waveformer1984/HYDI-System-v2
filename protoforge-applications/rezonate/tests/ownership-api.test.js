const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApi } = require('../src/api/router');

describe('Resonate Ownership API', () => {
  function listen(app) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, (err) => {
        if (err) return reject(err);
        resolve({ server, port: server.address().port });
      });
    });
  }

  it('creates and verifies ownership for an asset', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Owned Track' });
    const asset = repo.registerAsset(project.id, { type: 'vocal', file_path: 'vocal.wav' });
    const app = createApi(repo);
    const { server, port } = await listen(app);

    try {
      let res = await fetch(`http://localhost:${port}/ownership/assets/${asset.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: 'u1', ownership_type: 'creator', percentage: 100 })
      });
      let data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.record.percentage, 100);

      res = await fetch(`http://localhost:${port}/ownership/assets/${asset.id}/verify`, { method: 'POST' });
      data = await res.json();
      assert.strictEqual(data.record.status, 'verified');
    } finally {
      server.close();
    }
  });

  it('registers rights and adds a collaborator', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Collab Track' });
    const asset = repo.registerAsset(project.id, { type: 'sample', file_path: 'sample.wav' });
    const app = createApi(repo);
    const { server, port } = await listen(app);

    try {
      const res = await fetch(`http://localhost:${port}/ownership/assets/${asset.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creator_id: 'u2', percentage: 30, role: 'producer' })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.rights.collaborators.length, 1);
      assert.strictEqual(data.rights.collaborators[0].percentage, 30);
    } finally {
      server.close();
    }
  });

  it('lists ownership records for an asset', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Split Track' });
    const asset = repo.registerAsset(project.id, { type: 'mix', file_path: 'mix.wav' });
    repo.createOwnershipRecord(asset.id, { creator_id: 'u1', percentage: 80 });
    repo.createOwnershipRecord(asset.id, { creator_id: 'u2', percentage: 20, ownership_type: 'collaborator' });
    const app = createApi(repo);
    const { server, port } = await listen(app);

    try {
      const res = await fetch(`http://localhost:${port}/ownership/assets/${asset.id}`);
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.records.length, 2);
    } finally {
      server.close();
    }
  });
});
