const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const defaultEnginePath = path.join(__dirname, '..', '..', '..', 'rezonate');

function createDefaultRunner() {
  return (command, args) => new Promise((resolve, reject) => {
    execFile(command, args, { shell: false }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout, stderr, exitCode: 0 });
    });
  });
}

class ResonateEngineAdapter {
  constructor(options = {}) {
    this.enginePath = options.enginePath || defaultEnginePath;
    this.runner = options.runner || null;
    this.eventBus = options.eventBus || null;
    this.logger = options.logger || { warn: () => {}, info: () => {}, debug: () => {} };
    this.jobs = new Map();
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

  async _exec(command, args) {
    if (!this.runner) {
      throw new Error('Engine runner not configured');
    }
    return this.runner(command, args);
  }

  _emit(type, payload) {
    if (this.eventBus) this.eventBus.emit(type, payload);
  }

  async isAvailable() {
    if (!this.runner) return false;
    try {
      await this._exec('python', ['--version']);
      return true;
    } catch {
      return false;
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

  async generateSong({ prompt, clip = false, projectId = null } = {}) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { ok: false, error: 'prompt is required' };
    }
    const id = this._jobId();
    const args = clip ? ['generate.py', '--clip', prompt] : ['generate.py', prompt];
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
      const result = await this._exec('python', args);
      const audioPath = this._parseSavedPath(result.stdout);
      if (!audioPath) {
        job.status = 'failed';
        job.error = 'No audio returned by engine';
        return { ok: false, error: 'No audio returned by engine', jobId: id };
      }
      job.status = 'completed';
      job.audioPath = audioPath;
      job.completed_at = new Date().toISOString();
      this._emit('song.generated', { jobId: id, prompt, audioPath, projectId });
      this.logger.info('adapter', 'song.generated', `Song job ${id} generated at ${audioPath}`, { jobId: id });
      return {
        ok: true,
        jobId: id,
        prompt,
        clip,
        audioPath,
        engine: 'rezonate',
        metadata: { projectId, generatedAt: job.completed_at }
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
      const result = await this._exec('python', ['make-stems.py', sourcePath]);
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
      const result = await this._exec('python', ['make-stems.py', sourcePath]);
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

  _parseAnalysis(stdout) {
    const bpm = (stdout.match(/bpm:\s*([\d.]+)/i) || [])[1];
    const key = (stdout.match(/key:\s*([^\n\r]+)/i) || [])[1];
    return { bpm: bpm ? Number(bpm) : null, key: key ? key.trim() : null };
  }

  getProcessingStatus(id) {
    return this._status(id);
  }
}

module.exports = { ResonateEngineAdapter, createDefaultRunner };
