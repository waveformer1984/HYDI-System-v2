const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createRepository } = require('../src/repository');
const { createApi } = require('../src/api/router');
const { ResonateEngineAdapter } = require('../src/adapters/resonate-engine');

describe('Resonate API', () => {
  function listen(app) {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, (err) => {
        if (err) return reject(err);
        resolve({ server, port: server.address().port });
      });
    });
  }

  function mockAudioProvider(overrides = {}) {
    return {
      name: 'local',
      async generate(request) {
        if (overrides.error) return { ok: false, error: overrides.error };
        return {
          ok: true,
          audioPath: `C:\\\\audio\\\\${request.prompt.replace(/\s+/g, '-')}.mp3`,
          provider: 'local',
          model: 'mock-model',
          duration: request.duration || 120,
          metadata: { prompt: request.prompt }
        };
      },
      async health() {
        return { ok: true, available: true, modelAvailable: true, cloudDependency: false, provider: 'local' };
      },
      capabilities() {
        return { generate: true, stems: false, analyze: false };
      }
    };
  }

  function mockStemRunner() {
    return async (cmd, args) => {
      if (args[0] === 'make-stems.py') {
        return { stdout: `Done.\n  bpm: 120 | key: C major\n  folder: C:\\\\audio\\\\stems`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
  }

  function mockEngine(overrides = {}) {
    return new ResonateEngineAdapter({
      audioProvider: mockAudioProvider(overrides),
      runner: mockStemRunner(),
      logger: { info: () => {}, warn: () => {} }
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

  it('runs a generate job and creates an audio asset', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Generate Test' });
    const engine = mockEngine({ prompt: 'lofi' });
    const app = createApi(repo, { engine });
    const { server, port } = await listen(app);

    try {
      let res = await fetch(`http://localhost:${port}/processing/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: 'generate', prompt: 'lofi beat', project_id: project.id })
      });
      let data = await res.json();
      assert.strictEqual(res.status, 201);
      const jobId = data.job.id;

      res = await fetch(`http://localhost:${port}/processing/jobs/${jobId}/start`, { method: 'POST' });
      data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.job.state, 'completed');
      assert.ok(data.asset);
      assert.strictEqual(data.asset.type, 'generated_song');
      assert.ok(data.asset.file_path);
    } finally {
      server.close();
    }
  });

  it('registers an asset and serves it', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Pack' });
    const app = createApi(repo);
    const { server, port } = await listen(app);

    const fs = require('fs');
    const path = require('path');
    const tmpDir = path.join(process.cwd(), 'tmp-test');
    const tmpFile = path.join(tmpDir, 'vocal.wav');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpFile, 'fake audio');

    try {
      const res = await fetch(`http://localhost:${port}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          type: 'vocal',
          file_path: tmpFile,
          bpm: 95,
          key: 'F minor'
        })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 201);
      assert.strictEqual(data.asset.type, 'vocal');
      assert.strictEqual(data.asset.bpm, 95);

      const getRes = await fetch(`http://localhost:${port}/assets/${data.asset.id}/file`);
      assert.strictEqual(getRes.status, 200);
      const text = await getRes.text();
      assert.strictEqual(text, 'fake audio');
    } finally {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('fails a generate job when engine returns no audio', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Fail Test' });
    const engine = new ResonateEngineAdapter({
      audioProvider: { async generate() { return { ok: false, error: 'No audio returned' }; }, async health() { return { available: true }; } },
      runner: mockStemRunner(),
      logger: { info: () => {}, warn: () => {} }
    });
    const app = createApi(repo, { engine });
    const { server, port } = await listen(app);

    try {
      let res = await fetch(`http://localhost:${port}/processing/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: 'generate', prompt: 'fail', project_id: project.id })
      });
      let data = await res.json();
      const jobId = data.job.id;

      res = await fetch(`http://localhost:${port}/processing/jobs/${jobId}/start`, { method: 'POST' });
      data = await res.json();
      assert.strictEqual(res.status, 502);
      assert.strictEqual(data.ok, false);
      assert.match(data.error, /No audio/);
    } finally {
      server.close();
    }
  });

  it('runs a stems job and completes', async () => {
    const repo = createRepository();
    await repo.init();
    const project = repo.createProject({ name: 'Stems Test' });
    const engine = mockEngine();
    const app = createApi(repo, { engine });
    const { server, port } = await listen(app);

    try {
      let res = await fetch(`http://localhost:${port}/processing/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: 'stems', source_path: 'C:\\\\audio\\\\track.mp3', project_id: project.id })
      });
      let data = await res.json();
      const jobId = data.job.id;

      res = await fetch(`http://localhost:${port}/processing/jobs/${jobId}/start`, { method: 'POST' });
      data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.job.state, 'completed');
      assert.strictEqual(data.job.metadata.folder, 'C:\\\\audio\\\\stems');
    } finally {
      server.close();
    }
  });
});
