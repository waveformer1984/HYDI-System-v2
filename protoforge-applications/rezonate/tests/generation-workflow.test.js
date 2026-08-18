const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { ResonateEngineAdapter } = require('../src/adapters/resonate-engine');
const { LocalAudioProvider } = require('../src/providers/local-audio-provider');
const { LocalModelRuntime } = require('../src/adapters/local-model-runtime');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('Resonate Generation Workflow', () => {
  function makeRepo() {
    const repo = createRepository();
    repo.init();
    return repo;
  }

  function makeAudioProvider(opts = {}) {
    return new LocalAudioProvider({
      runtime: new LocalModelRuntime({
        runner: opts.runner || (async (cmd, args) => {
          const slug = (args[1] || 'generated').toLowerCase().replace(/\s+/g, '-');
          return { stdout: `Saved: C:\\\\audio\\\\${slug}.mp3`, stderr: '', exitCode: 0 };
        })
      })
    });
  }

  it('creates a generate processing job', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Flow' });
    const job = repo.createProcessingJob({
      task_type: 'generate',
      project_id: project.id,
      prompt: 'ambient electronic composition',
      clip: false
    });

    assert.strictEqual(job.type, 'generate');
    assert.strictEqual(job.state, 'queued');
    assert.strictEqual(job.prompt, 'ambient electronic composition');
    assert.strictEqual(job.project_id, project.id);
  });

  it('requires prompt for generate job', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Flow' });
    const job = repo.createProcessingJob({
      task_type: 'generate',
      project_id: project.id
    });
    assert.strictEqual(job.prompt, null);
  });

  it('adapter generates through local provider', async () => {
    const engine = new ResonateEngineAdapter({
      audioProvider: makeAudioProvider()
    });
    const result = await engine.generateSong({ prompt: 'techno loop' });

    assert.strictEqual(result.ok, true);
    assert.ok(result.audioPath);
    assert.strictEqual(result.provider, 'local');
    assert.strictEqual(result.engine, 'rezonate');
  });

  it('engine surfaces provider failures', async () => {
    const engine = new ResonateEngineAdapter({
      audioProvider: { async generate() { return { ok: false, error: 'model crashed' }; } }
    });
    const result = await engine.generateSong({ prompt: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /model crashed/);
  });

  it('audio asset is created from generated result', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Asset Test' });
    const asset = repo.registerAsset(project.id, {
      type: 'generated_song',
      file_path: 'C:\\\\audio\\\\song.mp3',
      metadata: { source: 'ai-generation', engine: 'local', prompt: 'piano' }
    });

    assert.strictEqual(asset.type, 'generated_song');
    assert.strictEqual(asset.file_path, 'C:\\\\audio\\\\song.mp3');
    assert.strictEqual(asset.metadata.source, 'ai-generation');
    assert.strictEqual(asset.project_id, project.id);
  });

  it('emits audio.asset.created event through repository', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const repo = createRepository({ eventBus: bus });
    repo.init();
    const project = repo.createProject({ name: 'Event Test' });
    repo.registerAsset(project.id, {
      type: 'generated_song',
      file_path: 'song.mp3',
      metadata: { source: 'ai-generation', engine: 'local' }
    });

    const events = transport.ofType('audio.asset.created');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].payload.type, 'generated_song');
    assert.strictEqual(events[0].payload.source, 'ai-generation');
    assert.ok(events[0].payload.assetId);
    assert.ok(events[0].payload.projectId);
  });

  it('repository startProcessingJob transitions generate job to generating', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Transition' });
    const job = repo.createProcessingJob({ task_type: 'generate', project_id: project.id, prompt: 'x' });
    const started = repo.startProcessingJob(job.id);
    assert.strictEqual(started.state, 'generating');
  });

  it('completeProcessingJob transitions to completed with metadata', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Complete' });
    const job = repo.createProcessingJob({ task_type: 'generate', project_id: project.id, prompt: 'x' });
    repo.startProcessingJob(job.id);
    const completed = repo.completeProcessingJob(job.id, { audioPath: 'a.mp3' });
    assert.strictEqual(completed.state, 'completed');
    assert.strictEqual(completed.metadata.audioPath, 'a.mp3');
  });

  it('failProcessingJob captures error and transitions to failed', () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: 'Fail' });
    const job = repo.createProcessingJob({ task_type: 'generate', project_id: project.id, prompt: 'x' });
    const failed = repo.failProcessingJob(job.id, 'engine timeout');
    assert.strictEqual(failed.state, 'failed');
    assert.strictEqual(failed.error, 'engine timeout');
  });

  it('end-to-end generate job through repository with event capture', async () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const repo = createRepository({ eventBus: bus });
    repo.init();
    const project = repo.createProject({ name: 'End-to-End' });
    const engine = new ResonateEngineAdapter({
      audioProvider: makeAudioProvider()
    });

    const job = repo.createProcessingJob({ task_type: 'generate', project_id: project.id, prompt: 'lofi' });
    repo.startProcessingJob(job.id);
    const result = await engine.generateSong({ prompt: 'lofi', projectId: project.id });
    assert.strictEqual(result.ok, true);

    const asset = repo.registerAsset(project.id, {
      type: 'generated_song',
      file_path: result.audioPath,
      metadata: { source: 'ai-generation', engine: 'local', prompt: 'lofi' }
    });
    repo.completeProcessingJob(job.id, { assetId: asset.id });

    const completedEvents = transport.ofType('processing.completed');
    assert.strictEqual(completedEvents.length, 1);
    const assetEvents = transport.ofType('audio.asset.created');
    assert.strictEqual(assetEvents.length, 1);
    assert.strictEqual(assetEvents[0].payload.projectId, project.id);
  });
});
