const { AudioProvider } = require('./audio-provider');
const { LocalModelRuntime } = require('../adapters/local-model-runtime');

class LocalAudioProvider extends AudioProvider {
  constructor(options = {}) {
    super({ name: 'local', model: options.model || 'local-audio-model' });
    this.runtime = options.runtime || new LocalModelRuntime(options);
    this.maxDuration = options.maxDuration || 1800;
    this.logger = options.logger || { info: () => {}, warn: () => {} };
  }

  async generate(request = {}) {
    if (!request.prompt || typeof request.prompt !== 'string' || !request.prompt.trim()) {
      return { ok: false, error: 'prompt is required' };
    }
    const duration = request.duration || (request.clip ? 30 : 120);
    if (duration <= 0 || duration > this.maxDuration) {
      return { ok: false, error: `duration must be between 1 and ${this.maxDuration} seconds` };
    }

    const runtimeRes = await this.runtime.run({
      prompt: request.prompt,
      duration,
      clip: !!request.clip,
      outputDir: request.outputDir
    });

    if (!runtimeRes.ok) {
      this.logger.warn('provider', 'local.generate.failed', runtimeRes.error);
      return { ok: false, error: runtimeRes.error };
    }

    return {
      ok: true,
      audioPath: runtimeRes.audioPath,
      provider: this.name,
      model: this.model,
      duration,
      metadata: { ...runtimeRes.metadata, duration, clip: !!request.clip }
    };
  }

  async health() {
    return this.runtime.health();
  }

  capabilities() {
    return { generate: true, stems: false, analyze: false };
  }
}

module.exports = { LocalAudioProvider };
