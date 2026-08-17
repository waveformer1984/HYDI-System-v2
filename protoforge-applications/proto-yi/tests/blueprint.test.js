const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApi } = require('../src/api/router');

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, (err) => {
      if (err) return reject(err);
      resolve({ server, port: server.address().port });
    });
  });
}

describe('ProtoForge application blueprint', () => {
  it('creates and retrieves records', () => {
    const repo = createRepository();
    const created = repo.createRecord({ name: 'Sample' });
    assert.ok(created.id);
    const found = repo.getRecord(created.id);
    assert.strictEqual(found.name, 'Sample');
  });

  it('emits domain events', () => {
    const repo = createRepository();
    let emitted = null;
    repo.eventBus.on('record.created', (e) => { emitted = e; });
    repo.createRecord({ name: 'Evented' });
    assert.ok(emitted);
    assert.strictEqual(emitted.type, 'record.created');
  });

  it('exposes API endpoints', async () => {
    const repo = createRepository();
    const app = createApi(repo);
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.ok, true);
      assert.ok(data.requestId);
    } finally {
      server.close();
    }
  });
});
