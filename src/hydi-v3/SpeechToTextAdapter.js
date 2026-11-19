'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_STT = 'http://127.0.0.1:9000';
const DEFAULT_STT_TIMEOUT_MS = 30000;
const HEALTH_TIMEOUT_MS = 5000;

function requestRaw(method, url, { headers = {}, body = null, timeoutMs = 15000, encoding = 'utf8' } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const u = new URL(url);
      const opts = {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        headers: { ...headers },
        timeout: timeoutMs,
      };
      const client = u.protocol === 'https:' ? https : http;
      const req = client.request(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          finish({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body: encoding === 'utf8' ? buf.toString('utf8') : buf,
          });
        });
      });
      req.on('error', (e) => finish({ ok: false, error: e.message || 'network' }));
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, error: 'timeout' });
      });
      if (body) req.write(body);
      req.end();
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : 'request_failed' });
    }
  });
}

function postMultipart(url, fieldName, filename, mime, buffer, timeoutMs) {
  const boundary = `----heidi-voice-${Date.now()}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([prefix, buffer, suffix]);
  return requestRaw('POST', url, {
    timeoutMs,
    encoding: 'utf8',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
}

/** @typedef {{ getJson: (url: string, timeoutMs?: number) => Promise<any>, postMultipart: typeof postMultipart, postJson: (url: string, payload: object, timeoutMs?: number) => Promise<any> }} VoiceHttp */

/** @type {VoiceHttp} */
const defaultVoiceHttp = {
  getJson: async (url, timeoutMs = HEALTH_TIMEOUT_MS) => {
    const r = await requestRaw('GET', url, { timeoutMs, encoding: 'utf8' });
    if (!r.ok) return r;
    try {
      return { ...r, json: r.body ? JSON.parse(r.body) : {} };
    } catch {
      return { ok: false, error: 'malformed_json', status: r.status };
    }
  },
  postMultipart,
  postJson: async (url, payload, timeoutMs = DEFAULT_STT_TIMEOUT_MS) => {
    const data = JSON.stringify(payload);
    return requestRaw('POST', url, {
      timeoutMs,
      encoding: 'buffer',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      body: data,
    });
  },
};

class SpeechToTextAdapter {
  constructor(config = {}) {
    this.name = config.name || 'stt';
    this.endpoint = (config.endpoint || process.env.VOICE_STT_URL || DEFAULT_STT).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_STT_TIMEOUT_MS;
    this.http = config.http || defaultVoiceHttp;
  }

  async healthCheck() {
    try {
      const r = await this.http.getJson(`${this.endpoint}/health`, HEALTH_TIMEOUT_MS);
      if (!r.ok) return { ok: false, error: r.error || `stt_health_${r.status || 'fail'}` };
      const json = r.json || {};
      return { ok: Boolean(json.ok), service: json.service || 'stt', model: json.model || null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'stt_health_error' };
    }
  }

  /**
   * @param {Buffer} audioBuffer
   * @param {{ filename?: string, mime?: string }} [opts]
   */
  async transcribe(audioBuffer, opts = {}) {
    try {
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        return { ok: false, text: '', error: 'empty_audio' };
      }
      const filename = opts.filename || 'clip.wav';
      const mime = opts.mime || 'audio/wav';
      const r = await this.http.postMultipart(
        `${this.endpoint}/stt`,
        'file',
        filename,
        mime,
        audioBuffer,
        this.timeoutMs,
      );
      if (!r.ok) {
        return { ok: false, text: '', error: r.error || `stt_http_${r.status || 'fail'}` };
      }
      let json;
      try {
        json = typeof r.body === 'string' ? JSON.parse(r.body) : {};
      } catch {
        return { ok: false, text: '', error: 'malformed_stt_response' };
      }
      if (!json.ok) return { ok: false, text: '', error: json.error || 'stt_failed' };
      return {
        ok: true,
        text: typeof json.text === 'string' ? json.text : '',
        duration_ms: typeof json.duration_ms === 'number' ? json.duration_ms : undefined,
      };
    } catch (e) {
      return { ok: false, text: '', error: e instanceof Error ? e.message : 'stt_error' };
    }
  }
}

module.exports = SpeechToTextAdapter;
module.exports._voiceHttp = defaultVoiceHttp;