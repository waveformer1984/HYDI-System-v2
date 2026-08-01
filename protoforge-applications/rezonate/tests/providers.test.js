const { describe, it } = require('node:test');
const assert = require('node:assert');
const { AudioProvider } = require('../src/providers/audio-provider');
const { LocalAudioProvider } = require('../src/providers/local-audio-provider');
const { ProviderRegistry } = require('../src/providers/provider-registry');
const { LocalModelRuntime } = require('../src/adapters/local-model-runtime');

describe('Audio Provider Layer', () => {
  it('AudioProvider is abstract', async () => {
    const p = new AudioProvider();
    try {
      await p.generate({ prompt: 'x' });
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /must be implemented/);
    }
    const h = await p.health();
    assert.strictEqual(h.available, false);
    assert.deepStrictEqual(p.capabilities(), { generate: false, stems: false, analyze: false });
  });

  it('LocalAudioProvider requires prompt', async () => {
    const p = new LocalAudioProvider({ runtime: new LocalModelRuntime({ runner: async () => ({}) }) });
    const res = await p.generate({});
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /prompt is required/);
  });

  it('LocalAudioProvider rejects invalid duration', async () => {
    const p = new LocalAudioProvider({ runtime: new LocalModelRuntime({ runner: async () => ({}) }) });
    const res = await p.generate({ prompt: 'x', duration: -5 });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /duration must be/);
  });

  it('LocalAudioProvider generates and returns local provider metadata', async () => {
    const p = new LocalAudioProvider({
      runtime: new LocalModelRuntime({
        runner: async () => ({ stdout: 'Saved: C:\\\\audio\\\\test.mp3', stderr: '', exitCode: 0 })
      })
    });
    const res = await p.generate({ prompt: 'test', duration: 60 });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.audioPath, 'C:\\\\audio\\\\test.mp3');
    assert.strictEqual(res.provider, 'local');
    assert.strictEqual(res.duration, 60);
  });

  it('LocalAudioProvider reports failure from runtime', async () => {
    const p = new LocalAudioProvider({
      runtime: new LocalModelRuntime({
        runner: async () => { throw new Error('model crashed'); }
      })
    });
    const res = await p.generate({ prompt: 'fail', duration: 30 });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /model crashed/);
  });

  it('LocalAudioProvider uses 30 second clip when requested', async () => {
    let captured;
    const p = new LocalAudioProvider({
      runtime: new LocalModelRuntime({
        runner: async (cmd, args) => {
          captured = args;
          return { stdout: 'Saved: C:\\\\audio\\\\clip.mp3', stderr: '', exitCode: 0 };
        }
      })
    });
    await p.generate({ prompt: 'short', clip: true });
    assert.strictEqual(captured[3], '1');
  });

  it('LocalAudioProvider health passes through runtime health', async () => {
    const p = new LocalAudioProvider({
      runtime: new LocalModelRuntime({
        runner: async () => ({ stdout: 'Saved: x', stderr: '', exitCode: 0 })
      })
    });
    const h = await p.health();
    assert.strictEqual(h.available, true);
    assert.strictEqual(h.cloudDependency, false);
  });

  it('ProviderRegistry registers and resolves providers', () => {
    const r = new ProviderRegistry();
    const p = { generate: async () => ({}), health: async () => ({}), capabilities: () => ({}) };
    r.register('local', p);
    assert.strictEqual(r.resolve('local'), p);
    assert.deepStrictEqual(r.list(), ['local']);
    assert.strictEqual(r.resolve('cloud'), null);
  });

  it('ProviderRegistry rejects invalid registrations', () => {
    const r = new ProviderRegistry();
    try {
      r.register('', { generate: async () => ({}) });
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /name is required/);
    }
    try {
      r.register('x', {});
      assert.fail('should throw');
    } catch (err) {
      assert.match(err.message, /must implement generate/);
    }
  });

  it('ProviderRegistry health returns provider health', async () => {
    const r = new ProviderRegistry();
    r.register('local', new LocalAudioProvider({
      runtime: new LocalModelRuntime({ runner: async () => ({}) })
    }));
    const h = await r.health('local');
    assert.strictEqual(h.available, true);
  });

  it('LocalAudioProvider capabilities show generate only', () => {
    const p = new LocalAudioProvider({ runtime: new LocalModelRuntime({}) });
    assert.deepStrictEqual(p.capabilities(), { generate: true, stems: false, analyze: false });
  });
});
