'use strict';

class TextToSpeechAdapter {
  constructor(config = {}) {
    this.name = config.name || 'tts';
    this.endpoint = config.endpoint || 'http://localhost:9001'; // Placeholder local TTS
  }

  async synthesize(text) { // eslint-disable-line no-unused-vars
    // Local TTS placeholder.
    return { ok: false, audio: null, error: 'Local TTS not configured' };
  }
}

module.exports = TextToSpeechAdapter;
