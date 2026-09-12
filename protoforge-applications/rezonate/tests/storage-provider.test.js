const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStorageProvider } = require('../src/storage/storage-provider');
const { LocalStorageProvider } = require('../src/storage/local-storage-provider');
const { SupabaseStorageProvider } = require('../src/storage/supabase-storage-provider');

/**
 * Minimal fake @supabase/supabase-js Storage client — mirrors the approach in
 * tests/supabase-store.test.js (constructor-injected client, no network/library).
 */
function makeFakeSupabaseStorage() {
  const files = new Map(); // key -> Buffer
  const client = {
    storage: {
      from(bucket) {
        return {
          async upload(key, buffer, _opts) {
            files.set(`${bucket}/${key}`, Buffer.from(buffer));
            return { data: { path: key }, error: null };
          },
          async download(key) {
            const buf = files.get(`${bucket}/${key}`);
            if (!buf) return { data: null, error: { message: 'not found' } };
            return { data: buf, error: null };
          },
          async list(dir) {
            const prefix = `${bucket}/${dir}`;
            const names = [];
            for (const k of files.keys()) {
              if (k.startsWith(prefix)) {
                const rest = k.slice(prefix.length).replace(/^\//, '');
                if (rest && !rest.includes('/')) names.push({ name: rest });
              }
            }
            return { data: names, error: null };
          },
          async remove(keys) {
            for (const key of keys) files.delete(`${bucket}/${key}`);
            return { data: {}, error: null };
          }
        };
      }
    }
  };
  return { client, files };
}

describe('StorageProvider factory', () => {
  it('defaults to LocalStorageProvider', () => {
    const provider = createStorageProvider();
    assert.ok(provider instanceof LocalStorageProvider);
    assert.strictEqual(provider.name(), 'local');
  });

  it('creates SupabaseStorageProvider only when type: "supabase" is explicit', () => {
    const { client } = makeFakeSupabaseStorage();
    const provider = createStorageProvider({ type: 'supabase', client });
    assert.ok(provider instanceof SupabaseStorageProvider);
    assert.strictEqual(provider.name(), 'supabase');
  });
});

describe('LocalStorageProvider', () => {
  // Uses the OS temp dir rather than a path under the repo's mounted directory.
  // tests/api.test.js's pre-existing, deliberately-preserved EPERM failure (see
  // docs/REZONATE_CONSOLIDATION_PLAN.md) is a quirk of this sandbox's mount of the
  // repo folder specifically, not of LocalStorageProvider's logic — os.tmpdir() sits
  // outside that mount and avoids reproducing the same environment artifact here.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezonate-storage-test-'));

  it('saves, reads, checks existence, and deletes a file by absolute path', async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const provider = new LocalStorageProvider();
    const target = path.join(tmpDir, 'clip.wav');

    const saveResult = await provider.save(target, Buffer.from('audio-bytes'));
    assert.strictEqual(saveResult.ok, true);
    assert.ok(await provider.exists(target));

    const read = await provider.read(target);
    assert.strictEqual(read.toString(), 'audio-bytes');

    const del = await provider.delete(target);
    assert.strictEqual(del.ok, true);
    assert.strictEqual(await provider.exists(target), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves relative keys against baseDir when provided', async () => {
    const provider = new LocalStorageProvider({ baseDir: tmpDir });
    await provider.save('nested/track.wav', Buffer.from('x'));
    assert.ok(fs.existsSync(path.join(tmpDir, 'nested', 'track.wav')));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('read() returns null for a missing file rather than throwing', async () => {
    const provider = new LocalStorageProvider();
    const result = await provider.read(path.join(tmpDir, 'does-not-exist.wav'));
    assert.strictEqual(result, null);
  });
});

describe('SupabaseStorageProvider', () => {
  it('requires an injected client', () => {
    assert.throws(() => new SupabaseStorageProvider({}), /requires an injected Supabase client/);
  });

  it('saves and reads back a file through the bucket', async () => {
    const { client } = makeFakeSupabaseStorage();
    const provider = new SupabaseStorageProvider({ client, bucket: 'test-bucket' });

    const saveResult = await provider.save('song.mp3', Buffer.from('bytes'));
    assert.strictEqual(saveResult.ok, true);

    const read = await provider.read('song.mp3');
    assert.strictEqual(read.toString(), 'bytes');
  });

  it('exists() reflects list() contents', async () => {
    const { client } = makeFakeSupabaseStorage();
    const provider = new SupabaseStorageProvider({ client });
    assert.strictEqual(await provider.exists('missing.mp3'), false);
    await provider.save('present.mp3', Buffer.from('x'));
    assert.strictEqual(await provider.exists('present.mp3'), true);
  });

  it('delete() removes the object', async () => {
    const { client } = makeFakeSupabaseStorage();
    const provider = new SupabaseStorageProvider({ client });
    await provider.save('gone.mp3', Buffer.from('x'));
    const del = await provider.delete('gone.mp3');
    assert.strictEqual(del.ok, true);
    assert.strictEqual(await provider.exists('gone.mp3'), false);
  });

  it('read() returns null when the object is not found', async () => {
    const { client } = makeFakeSupabaseStorage();
    const provider = new SupabaseStorageProvider({ client });
    const result = await provider.read('nope.mp3');
    assert.strictEqual(result, null);
  });
});
