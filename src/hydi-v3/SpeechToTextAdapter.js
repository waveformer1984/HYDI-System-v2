'use strict';

class SpeechToTextAdapter {
  constructor(config = {}) {
    this.name = config.name || 'stt';
    this.endpoint = config.endpoint || 'http://localhost:9000'; // Placeholder Whisper-compatible
  }

  async transcribe(audioBuffer) { // eslint-disable-line no-unused-vars
    // Local Whisper-compatible placeholder.
    return { ok: false, text: '', error: 'Local STT not configured' };
  }
}

module.exports = SpeechToTextAdapter;
