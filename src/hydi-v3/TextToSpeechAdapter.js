'use strict';

const { _voiceHttp: defaultVoiceHttp } = require('./SpeechToTextAdapter');

const DEFAULT_TTS = 'http://127.0.0.1:9001';
const DEFAULT_TTS_TIMEOUT_MS = 15000;
const MAX_TTS_CHARS = 1000;

class TextToSpeechAdapter {
  constructor(config = {}) {
    this.name = config.name || 'tts';
    this.endpoint = (config.endpoint || process.env.VOICE_TTS_URL || DEFAULT_TTS).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
    this.http = config.http || defaultVoiceHttp;
  }

  async healthCheck() {
    try {
      const r = await this.http.getJson(`${this.endpoint}/health`, 5000);
      if (!r.ok) return { ok: false, error: r.error || `tts_health_${r.status || 'fail'}` };
      const json = r.json || {};
      return { ok: Boolean(json.ok), service: json.service || 'tts', voice: json.voice || null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'tts_health_error' };
    }
  }

  async synthesize(text) {
    try {
      if (typeof text !== 'string' || !text.trim()) {
        return { ok: false, audio: null, error: 'empty_text' };
      }
      const trimmed = text.trim();
      if (trimmed.length > MAX_TTS_CHARS) {
        return { ok: false, audio: null, error: 'text_too_long' };
      }
      const r = await this.http.postJson(
        `${this.endpoint}/tts`,
        { text: trimmed },
        this.timeoutMs,
      );
      if (!r.ok) {
        return { ok: false, audio: null, error: r.error || `tts_http_${r.status || 'fail'}` };
      }
      const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.from(String(r.body || ''), 'binary');
      if (!buf.length || !buf.slice(0, 4).equals(Buffer.from('RIFF'))) {
        let err = 'invalid_wav';
        try {
          const json = JSON.parse(buf.toString('utf8'));
          if (json && json.ok === false) err = json.error || err;
        } catch {
          /* binary wav expected */
        }
        return { ok: false, audio: null, error: err };
      }
      return { ok: true, audio: buf, mime: 'audio/wav' };
    } catch (e) {
      return { ok: false, audio: null, error: e instanceof Error ? e.message : 'tts_error' };
    }
  }
}

module.exports = TextToSpeechAdapter;