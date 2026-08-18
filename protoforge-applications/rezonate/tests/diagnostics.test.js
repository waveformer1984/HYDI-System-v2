const { describe, it } = require('node:test');
const assert = require('node:assert');
const { collectDiagnostics } = require('../src/diagnostics');
const { createRepository } = require('../src/repository');

describe('Diagnostics', () => {
  it('reports local audio provider status', async () => {
    const repo = createRepository();
    await repo.init();
    const diag = await collectDiagnostics(repo);

    assert.strictEqual(diag.ok, true);
    assert.strictEqual(diag.engine.audioProvider, 'local');
    assert.strictEqual(diag.engine.cloudDependency, false);
  });

  it('reports model unavailable when not configured', async () => {
    const diag = await collectDiagnostics();
    assert.strictEqual(diag.engine.modelAvailable, false);
    assert.ok(diag.engine.reason);
  });
});
