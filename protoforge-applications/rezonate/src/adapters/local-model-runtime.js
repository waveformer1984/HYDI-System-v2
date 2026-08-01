const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function createDefaultModelRunner() {
  return (command, args) => new Promise((resolve, reject) => {
    execFile(command, args, { shell: false }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout, stderr, exitCode: 0 });
    });
  });
}

class LocalModelRuntime {
  constructor(options = {}) {
    this._customRunner = !!options.runner;
    this.command = options.command || process.env.AUDIO_MODEL_RUNTIME || null;
    this.modelPath = options.modelPath || process.env.AUDIO_MODEL_PATH || null;
    this.device = options.device || process.env.AUDIO_DEVICE || 'cpu';
    this.outputDir = options.outputDir || path.join(process.cwd(), 'generated');
    this.runner = options.runner || (this.command ? createDefaultModelRunner() : null);
    this.logger = options.logger || { info: () => {}, warn: () => {} };
  }

  _jobId() {
    const now = Date.now();
    const hash = Math.random().toString(36).slice(2, 8);
    return `${now}-${hash}`;
  }

  _ensureOutputDir() {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  _parseSavedPath(stdout) {
    const m = (stdout || '').match(/Saved:\s*(.+?)(?:\r?\n|$)/);
    return m ? m[1].trim() : null;
  }

  async run(request = {}) {
    if (!this.runner) {
      return { ok: false, error: 'Local model runner not configured. Set AUDIO_MODEL_RUNTIME.' };
    }
    if (!request.prompt) {
      return { ok: false, error: 'prompt is required' };
    }
    if (!this._customRunner && !this.command) {
      return { ok: false, error: 'AUDIO_MODEL_RUNTIME not configured' };
    }

    const duration = request.duration || 30;
    const clip = request.clip ? '1' : '0';
    this._ensureOutputDir();
    const jobId = this._jobId();
    const outputPath = path.join(this.outputDir, `local-${jobId}.mp3`);

    try {
      const cmd = this.command || 'python';
      this.logger.info('runtime', 'local.generate', `Running ${cmd} for job ${jobId}`);
      const result = await this.runner(cmd, [this.modelPath, request.prompt, String(duration), clip, outputPath]);
      const audioPath = this._parseSavedPath(result.stdout) || outputPath;
      return {
        ok: true,
        audioPath,
        metadata: {
          command: this.command,
          modelPath: this.modelPath,
          device: this.device,
          duration,
          clip: !!request.clip,
          jobId,
          stdout: result.stdout,
          stderr: result.stderr
        }
      };
    } catch (err) {
      this.logger.warn('runtime', 'local.generate.failed', err.message);
      return { ok: false, error: err.message };
    }
  }

  async health() {
    const ok = !!this.runner && (!!this.command || this._customRunner);
    return {
      ok,
      available: ok,
      modelAvailable: ok,
      cloudDependency: false,
      provider: 'local',
      command: this.command,
      modelPath: this.modelPath,
      device: this.device,
      reason: ok ? null : 'Model runtime not configured'
    };
  }
}

module.exports = { LocalModelRuntime, createDefaultModelRunner };
