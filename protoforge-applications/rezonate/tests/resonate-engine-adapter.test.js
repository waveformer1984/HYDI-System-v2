const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ResonateEngineAdapter } = require('../src/adapters/resonate-engine');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('ResonateEngineAdapter', () => {
  let transport;
  let bus;
  let events;

  beforeEach(() => {
    transport = new MemoryTransport();
    bus = new EventBus([transport]);
    events = [];
    bus.on('song.generated', e => events.push(e));
    bus.on('stem.processing.started', e => events.push(e));
    bus.on('stem.processing.completed', e => events.push(e));
    bus.on('audio.asset.created', e => events.push(e));
  });

  it('reports engine unavailable when no runner is configured', async () => {
    const adapter = new ResonateEngineAdapter({ eventBus: bus });
    const available = await adapter.isAvailable();
    assert.strictEqual(available, false);
  });

  it('handles successful song generation', async () => {
    const runner = async (cmd, args) => ({ stdout: '', stderr: '', exitCode: 0 });
    const adapter = new ResonateEngineAdapter({ eventBus: bus, runner });
    const result = await adapter.generateSong({ prompt: 'warm lo-fi beat' });

    assert.strictEqual(result.ok, true);
    assert.ok(result.jobId);
    assert.strictEqual(result.prompt, 'warm lo-fi beat');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'song.generated');
    assert.strictEqual(events[0].payload.prompt, 'warm lo-fi beat');
  });

  it('rejects invalid generate input', async () => {
    const runner = async () => ({ stdout: '', stderr: '', exitCode: 0 });
    const adapter = new ResonateEngineAdapter({ eventBus: bus, runner });
    const result = await adapter.generateSong({ prompt: '' });

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /required/i);
    assert.strictEqual(events.length, 0);
  });

  it('emits stem processing events', async () => {
    const runner = async (cmd, args) => ({
      stdout: 'Done.\n  stems: vocals.wav, drums.wav\n  bpm: 120 | key: C major',
      stderr: '',
      exitCode: 0
    });
    const adapter = new ResonateEngineAdapter({ eventBus: bus, runner });
    const result = await adapter.createStems({ sourcePath: 'C:\\songs\\track.mp3' });

    assert.strictEqual(result.ok, true);
    assert.ok(result.jobId);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'stem.processing.started');
    assert.strictEqual(events[1].type, 'stem.processing.completed');
  });

  it('returns audio analysis metadata', async () => {
    const runner = async () => ({
      stdout: '\nDone.\n  stems: vocals.wav\n  bpm: 95 | key: F minor\n  folder: C:\\songs\\track',
      stderr: '',
      exitCode: 0
    });
    const adapter = new ResonateEngineAdapter({ eventBus: bus, runner });
    const result = await adapter.analyzeAudio({ sourcePath: 'C:\\songs\\track.mp3' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.bpm, 95);
    assert.strictEqual(result.key, 'F minor');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'audio.asset.created');
  });

  it('reports processing status for a started job', async () => {
    const runner = async () => ({ stdout: '', stderr: '', exitCode: 0 });
    const adapter = new ResonateEngineAdapter({ eventBus: bus, runner });
    const job = await adapter.generateSong({ prompt: 'techno loop' });
    const status = adapter.getProcessingStatus(job.jobId);

    assert.strictEqual(status.id, job.jobId);
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.type, 'generate');
  });

  it('surfaces runner failures as failed results', async () => {
    const runner = async () => { throw new Error('python not found'); };
    const adapter = new ResonateEngineAdapter({ eventBus: bus, runner });
    const result = await adapter.generateSong({ prompt: 'test' });

    assert.strictEqual(result.ok, false);
    assert.match(result.error, /python not found/);
  });
});
