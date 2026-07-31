const path = require('path');
const crypto = require('crypto');

const defaultEnginePath = path.join(__dirname, '..', '..', '..', 'rezonate');

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

  async generateSong({ prompt, clip = false } = {}) {
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
      created_at: new Date().toISOString()
    });

    try {
      await this._exec('python', args);
      job.status = 'completed';
      job.completed_at = new Date().toISOString();
      this._emit('song.generated', { jobId: id, prompt });
      this.logger.info('adapter', 'song.generated', `Song job ${id} generated`, { jobId: id });
      return { ok: true, jobId: id, prompt, clip };
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      this.logger.warn('adapter', 'song.generate.failed', err.message, { jobId: id });
      return { ok: false, error: err.message, jobId: id };
    }
  }

  async createStems({ sourcePath } = {}) {
    if (!sourcePath || typeof sourcePath !== 'string') {
      return { ok: false, error: 'sourcePath is required' };
    }
    const id = this._jobId();
    const job = this._register({
      id,
      type: 'stems',
      status: 'started',
      sourcePath,
      created_at: new Date().toISOString()
    });

    this._emit('stem.processing.started', { jobId: id, sourcePath });

    try {
      await this._exec('python', ['make-stems.py', sourcePath]);
      job.status = 'completed';
      job.completed_at = new Date().toISOString();
      this._emit('stem.processing.completed', { jobId: id, sourcePath });
      this.logger.info('adapter', 'stem.processing.completed', `Stems job ${id} completed`, { jobId: id });
      return { ok: true, jobId: id, sourcePath };
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      this.logger.warn('adapter', 'stem.processing.failed', err.message, { jobId: id });
      return { ok: false, error: err.message, jobId: id };
    }
  }

  async analyzeAudio({ sourcePath } = {}) {
    if (!sourcePath || typeof sourcePath !== 'string') {
      return { ok: false, error: 'sourcePath is required' };
    }
    const id = this._jobId();
    const job = this._register({
      id,
      type: 'analyze',
      status: 'started',
      sourcePath,
      created_at: new Date().toISOString()
    });

    try {
      const result = await this._exec('python', ['make-stems.py', sourcePath]);
      const meta = this._parseAnalysis(result.stdout || '');
      job.status = 'completed';
      job.result = meta;
      job.completed_at = new Date().toISOString();
      this._emit('audio.asset.created', { jobId: id, sourcePath, ...meta });
      this.logger.info('adapter', 'audio.analyzed', `Analysis job ${id} completed`, { jobId: id });
      return { ok: true, jobId: id, sourcePath, ...meta };
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

module.exports = { ResonateEngineAdapter };
