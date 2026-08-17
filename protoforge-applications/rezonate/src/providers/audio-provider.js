class AudioProvider {
  constructor(options = {}) {
    this.name = options.name || 'unknown';
    this.model = options.model || 'unknown';
  }

  async generate(request) {
    throw new Error('generate() must be implemented by provider');
  }

  async health() {
    return { ok: false, available: false, reason: 'not implemented' };
  }

  capabilities() {
    return { generate: false, stems: false, analyze: false };
  }
}

module.exports = { AudioProvider };
