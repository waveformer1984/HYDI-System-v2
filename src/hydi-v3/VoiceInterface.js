'use strict';

const SpeechToTextAdapter = require('./SpeechToTextAdapter');
const TextToSpeechAdapter = require('./TextToSpeechAdapter');
const VoiceCommandRouter = require('./VoiceCommandRouter');

class VoiceInterface {
  constructor(config = {}) {
    this.stt = config.stt || new SpeechToTextAdapter(config.sttConfig);
    this.tts = config.tts || new TextToSpeechAdapter(config.ttsConfig);
    this.router = config.voiceCommandRouter || new VoiceCommandRouter({ stt: this.stt, conversationEngine: config.conversationEngine, logger: config.logger });
    this.logger = config.logger || console;
  }

  async listen(audioBuffer) {
    return this.router.handleAudio(audioBuffer);
  }

  async speak(text) {
    return this.tts.synthesize(text);
  }

  async command(text) {
    return this.router.handleText(text);
  }
}

module.exports = VoiceInterface;
