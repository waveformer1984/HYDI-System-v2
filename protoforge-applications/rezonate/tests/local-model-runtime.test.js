const { describe, it } = require('node:test');
const assert = require('node:assert');
const { LocalModelRuntime } = require('../src/adapters/local-model-runtime');

describe('Local Model Runtime', () => {
  it('requires prompt', async () => {
    const rt = new LocalModelRuntime({
      runner: async () => ({ stdout: 'Saved: x', stderr: '', exitCode: 0 })
    });
    const res = await rt.run({});
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /prompt is required/);
  });

  it('requires configuration without custom runner', async () => {
    const rt = new LocalModelRuntime();
    const res = await rt.run({ prompt: 'x' });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /AUDIO_MODEL_RUNTIME/);
    const h = await rt.health();
    assert.strictEqual(h.available, false);
  });

  it('runs custom runner and parses saved path', async () => {
    const calls = [];
    const rt = new LocalModelRuntime({
      runner: async (cmd, args) => {
        calls.push({ cmd, args });
        return { stdout: 'Saved: C:\\\\audio\\\\local.mp3', stderr: '', exitCode: 0 };
      }
    });
    const res = await rt.run({ prompt: 'dark electronic track', duration: 120, clip: false });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.audioPath, 'C:\\\\audio\\\\local.mp3');
    assert.strictEqual(res.metadata.duration, 120);
    assert.strictEqual(res.metadata.clip, false);
    assert.ok(calls[0].cmd);
    assert.ok(calls[0].args.includes('dark electronic track'));
    assert.strictEqual(calls[0].args[2], '120');
    assert.strictEqual(calls[0].args[3], '0');
  });

  it('uses clip flag for preview', async () => {
    const calls = [];
    const rt = new LocalModelRuntime({
      runner: async (cmd, args) => {
        calls.push(args);
        return { stdout: 'Saved: C:\\\\audio\\\\clip.mp3', stderr: '', exitCode: 0 };
      }
    });
    await rt.run({ prompt: 'short', duration: 30, clip: true });
    assert.strictEqual(calls[0][3], '1');
  });

  it('surfaces runner errors', async () => {
    const rt = new LocalModelRuntime({
      runner: async () => { throw new Error('python not found'); }
    });
    const res = await rt.run({ prompt: 'x' });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /python not found/);
  });

  it('fails gracefully when stdout has no saved path', async () => {
    const rt = new LocalModelRuntime({
      runner: async () => ({ stdout: 'No audio returned.', stderr: '', exitCode: 0 })
    });
    const res = await rt.run({ prompt: 'x' });
    assert.strictEqual(res.ok, true);
    assert.ok(res.audioPath); // falls back to output path
  });

  it('health returns configured status', async () => {
    const rt = new LocalModelRuntime({
      command: 'python',
      modelPath: 'C:\\\\models\\\\musicgen',
      runner: async () => ({})
    });
    const h = await rt.health();
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.modelAvailable, true);
    assert.strictEqual(h.cloudDependency, false);
    assert.strictEqual(h.command, 'python');
  });

  it('creates output directory on run', async () => {
    const fs = require('fs');
    const os = require('os');
    const dir = require('path').join(os.tmpdir(), 'rezonate-local-test-' + Date.now());
    const rt = new LocalModelRuntime({
      outputDir: dir,
      runner: async () => ({ stdout: 'Saved: x', stderr: '', exitCode: 0 })
    });
    await rt.run({ prompt: 'x' });
    assert.ok(fs.existsSync(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
