'use strict';

class VoiceCommandRouter {
  constructor(config = {}) {
    this.stt = config.stt || null;
    this.conversationEngine = config.conversationEngine || null;
    this.logger = config.logger || console;
  }

  async handleAudio(audioBuffer) {
    if (!this.stt) return { ok: false, error: 'STT not configured' };
    const transcribed = await this.stt.transcribe(audioBuffer);
    if (!transcribed.ok) return transcribed;
    if (!this.conversationEngine) return { ok: true, text: transcribed.text };
    const response = await this.conversationEngine.ask(transcribed.text);
    return { ok: true, transcript: transcribed.text, response: response.text };
  }

  async handleText(text) {
    if (!this.conversationEngine) return { ok: true, text };
    const response = await this.conversationEngine.ask(text);
    return { ok: true, transcript: text, response: response.text };
  }
}

module.exports = VoiceCommandRouter;
