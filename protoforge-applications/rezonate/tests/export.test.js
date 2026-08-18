const { describe, it } = require('node:test');
const assert = require('node:assert');
const { packageStems, packageManifest, createFileOps } = require('../src/export/packaging');

describe('Export Packaging', () => {
  function makeFileOps() {
    const written = {};
    const copied = [];
    return {
      ensureDir: (dir) => { written[dir] = true; },
      writeFile: (file, data) => { written[file] = data; },
      copyFile: (src, dest) => { copied.push({ src, dest }); },
      path: {
        join: (...args) => args.join('/'),
        basename: (p) => p.split('/').pop()
      },
      written,
      copied
    };
  }

  it('generates a manifest', () => {
    const manifest = packageManifest({
      project: 'My Track',
      projectId: 'abc',
      bpm: 120,
      key: 'C minor',
      assets: [{ id: 'a1', name: 'vocal.wav', type: 'vocal', bpm: 120, key: 'C minor' }]
    });
    assert.strictEqual(manifest.project, 'My Track');
    assert.strictEqual(manifest.bpm, 120);
    assert.strictEqual(manifest.assets.length, 1);
  });

  it('packages a stem bundle', () => {
    const ops = makeFileOps();
    const assets = [
      { id: 'a1', name: 'vocal.wav', file_path: 'src/vocal.wav', type: 'vocal' },
      { id: 'a2', name: 'drums.wav', file_path: 'src/drums.wav', type: 'stem' }
    ];
    const result = packageStems({
      projectId: 'proj-123',
      projectName: 'cool track',
      assets,
      bpm: 120,
      key: 'C minor',
      outputRoot: 'exports'
    }, ops);

    assert.ok(result.outDir);
    assert.strictEqual(result.packaged.length, 2);
    assert.strictEqual(Object.keys(ops.written).length, 2); // outDir + manifest
    assert.strictEqual(ops.copied.length, 2);
  });

  it('requires project id', () => {
    assert.throws(() => packageStems({}), /projectId is required/);
  });

  it('creates default file ops', () => {
    const ops = createFileOps('/tmp/exports');
    assert.ok(ops.ensureDir);
    assert.ok(ops.writeFile);
    assert.ok(ops.copyFile);
    assert.ok(ops.path.join);
  });
});
