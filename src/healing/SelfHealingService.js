'use strict';

const https = require('https');

class SelfHealingService {
  constructor(config = {}) {
    this._destroyed = false;
    this.config = {
      model: config.model || 'claude-3-haiku-20240307',
      maxTokens: config.maxTokens || 1024,
      apiHost: config.apiHost || 'api.anthropic.com',
      apiPath: config.apiPath || '/v1/messages',
      ...config,
    };
  }

  async diagnoseAndCorrect(issue) {
    if (this._destroyed) return null;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    try {
      const result = await this._callApi({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        messages: [{ role: 'user', content: `Diagnose and correct:\n${JSON.stringify(issue)}` }],
      }, apiKey);
      if (!this._destroyed) console.log('[SELF-HEALING] Diagnosis complete');
      return result;
    } catch (err) {
      if (!this._destroyed) console.error('[SELF-HEALING] diagnoseAndCorrect failed:', err.message);
      return null;
    }
  }

  async healFromCrash(error) {
    if (this._destroyed) return null;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const errorMsg = error instanceof Error ? error.message : String(error);
    try {
      const result = await this._callApi({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        messages: [{ role: 'user', content: `Service crashed: ${errorMsg}\nSuggest recovery.` }],
      }, apiKey);
      if (!this._destroyed) console.log('[SELF-HEALING] Crash recovery strategy generated');
      return result;
    } catch (err) {
      if (!this._destroyed) console.error('[SELF-HEALING] healFromCrash failed:', err.message);
      return null;
    }
  }

  _callApi(body, apiKey) {
    return new Promise((resolve, reject) => {
      if (this._destroyed) { resolve(null); return; }

      const data = JSON.stringify(body);
      const options = {
        hostname: this.config.apiHost,
        path: this.config.apiPath,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      };

      const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve(null); }
        });
      });

      req.on('error', (err) => {
        if (!this._destroyed) reject(err);
        else resolve(null);
      });

      req.write(data);
      req.end();
    });
  }

  destroy() {
    this._destroyed = true;
  }

  // Static convenience methods: allow calling on the class directly
  // (e.g. `const svc = require('./SelfHealingService'); svc.healFromCrash(...)`)
  static async healFromCrash(task, errorMessage, _loopId) {
    const instance = new SelfHealingService();
    return instance.healFromCrash(errorMessage);
  }

  static async diagnoseAndCorrect(issue) {
    const instance = new SelfHealingService();
    return instance.diagnoseAndCorrect(issue);
  }
}

module.exports = SelfHealingService;
