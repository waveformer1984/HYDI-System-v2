const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { LocalAudioProvider } = require('../providers/local-audio-provider');
const { LocalModelRuntime } = require('./local-model-runtime');

const defaultEnginePath = path.join(__dirname, '..', '..', '..', 'rezonate');

function createDefaultStemRunner() {
  return (command, args) => new Promise((resolve, reject) => {
    execFile(command, args, { shell: false }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout, stderr, exitCode: 0 });
    });
  });
}

function createDefaultAudioProvider(runner) {
  const runtime = new LocalModelRuntime({
    outputDir: path.join(defaultEnginePath, 'generated'),
    runner
  });
  return new LocalAudioProvider({ runtime, logger: { info: () => {}, warn: () => {} } });
}

class ResonateEngineAdapter {
  constructor(options = {}) {
    this.enginePath = options.enginePath || defaultEnginePath;
    this.stemRunner = options.stemRunner || options.runner || null;
    this.eventBus = options.eventBus || null;
    this.logger = options.logger || { warn: () => {}, info: () => {}, debug: () => {} };
    this.jobs = new Map();
    this.audioProvider = options.audioProvider || createDefaultAudioProvider(this.stemRunner);
  }

  _jobId() {
    return crypto.randomUUID();
  }

  _register(job) {
    this.jobs.set(job.id, job);
    return job;
  }

  _status(id) {
    return this.jobs.get(id) || { id, status: 'unknown' };
  }

  async _execStems(command, args) {
    if (!this.stemRunner) throw new Error('Engine runner not configured');
    return this.stemRunner(command, args);
  }

  _emit(type, payload) {
    if (this.eventBus) this.eventBus.emit(type, payload);
  }

  async isAvailable() {
    const health = await this.audioProvider.health();
    return health.available === true;
  }

  async generateSong({ prompt, duration, clip = false, projectId = null } = {}) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { ok: false, error: 'prompt is required' };
    }
    const id = this._jobId();
    const job = this._register({
      id,
      type: 'generate',
      status: 'started',
      prompt,
      clip,
      projectId,
      created_at: new Date().toISOString()
    });

    try {
      const result = await this.audioProvider.generate({ prompt, duration, clip });
      if (!result.ok) {
        job.status = 'failed';
        job.error = result.error;
        this.logger.warn('adapter', 'song.generate.failed', result.error, { jobId: id });
        return { ok: false, error: result.error, jobId: id };
      }
      job.status = 'completed';
      job.audioPath = result.audioPath;
      job.completed_at = new Date().toISOString();
      this._emit('song.generated', { jobId: id, prompt, audioPath: result.audioPath, projectId });
      this.logger.info('adapter', 'song.generated', `Song job ${id} generated at ${result.audioPath}`, { jobId: id });
      return {
        ok: true,
        jobId: id,
        prompt,
        clip,
        duration: result.duration,
        audioPath: result.audioPath,
        provider: result.provider,
        model: result.model,
        engine: 'rezonate',
        metadata: result.metadata
      };
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      this.logger.warn('adapter', 'song.generate.failed', err.message, { jobId: id });
      return { ok: false, error: err.message, jobId: id };
    }
  }

  async createStems({ sourcePath, projectId = null } = {}) {
    if (!sourcePath || typeof sourcePath !== 'string') {
      return { ok: false, error: 'sourcePath is required' };
    }
    const id = this._jobId();
    const job = this._register({
      id,
      type: 'stems',
      status: 'started',
      sourcePath,
      projectId,
      created_at: new Date().toISOString()
    });

    this._emit('stem.processing.started', { jobId: id, sourcePath, projectId });

    try {
      const result = await this._execStems('python', ['make-stems.py', sourcePath]);
      const folder = this._parseStemsFolder(result.stdout);
      job.status = 'completed';
      job.folder = folder;
      job.completed_at = new Date().toISOString();
      this._emit('stem.processing.completed', { jobId: id, sourcePath, folder, projectId });
      this.logger.info('adapter', 'stem.processing.completed', `Stems job ${id} completed`, { jobId: id });
      return { ok: true, jobId: id, sourcePath, folder };
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      this.logger.warn('adapter', 'stem.processing.failed', err.message, { jobId: id });
      return { ok: false, error: err.message, jobId: id };
    }
  }

  async analyzeAudio({ sourcePath, projectId = null } = {}) {
    if (!sourcePath || typeof sourcePath !== 'string') {
      return { ok: false, error: 'sourcePath is required' };
    }
    const id = this._jobId();
    const job = this._register({
      id,
      type: 'analyze',
      status: 'started',
      sourcePath,
      projectId,
      created_at: new Date().toISOString()
    });

    try {
      const result = await this._execStems('python', ['make-stems.py', sourcePath]);
      const meta = this._parseAnalysis(result.stdout || '');
      const folder = this._parseStemsFolder(result.stdout);
      job.status = 'completed';
      job.result = meta;
      job.folder = folder;
      job.completed_at = new Date().toISOString();
      this._emit('audio.asset.created', { jobId: id, sourcePath, folder, ...meta });
      this.logger.info('adapter', 'audio.analyzed', `Analysis job ${id} completed`, { jobId: id });
      return { ok: true, jobId: id, sourcePath, folder, ...meta };
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      this.logger.warn('adapter', 'audio.analyze.failed', err.message, { jobId: id });
      return { ok: false, error: err.message, jobId: id };
    }
  }

  _parseSavedPath(stdout) {
    const m = (stdout || '').match(/Saved:\s*(.+?)(?:\r?\n|$)/);
    return m ? m[1].trim() : null;
  }

  _parseStemsFolder(stdout) {
    const m = (stdout || '').match(/folder:\s*(.+?)(?:\r?\n|$)/i);
    return m ? m[1].trim() : null;
  }

  _parseAnalysis(stdout) {
    const bpm = (stdout.match(/bpm:\s*([\d.]+)/i) || [])[1];
    const key = (stdout.match(/key:\s*([^\n\r]+)/i) || [])[1];
    return { bpm: bpm ? Number(bpm) : null, key: key ? key.trim() : null };
  }

  getProcessingStatus(id) {
    return this._status(id);
  }
}

module.exports = { ResonateEngineAdapter, createDefaultStemRunner };
