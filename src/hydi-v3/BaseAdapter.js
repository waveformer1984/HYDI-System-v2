'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function request(method, url, body, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: timeoutMs,
    };

    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          const json = chunks ? JSON.parse(chunks) : {};
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: json });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    if (data) req.write(data);
    req.end();
  });
}

class BaseAdapter {
  constructor(config = {}) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.timeoutMs = config.timeoutMs || 30000;
  }

  get(endpoint) {
    return request('GET', `${this.baseUrl}${endpoint}`, null, this.timeoutMs);
  }

  post(endpoint, body) {
    return request('POST', `${this.baseUrl}${endpoint}`, body, this.timeoutMs);
  }

  /**
   * @param {any} messages
   * @param {any} [options]
   * @returns {Promise<any>}
   */
  async chat(messages, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error('chat() not implemented');
  }

  /**
   * @param {any} prompt
   * @param {any} [options]
   * @returns {Promise<any>}
   */
  async complete(prompt, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error('complete() not implemented');
  }

  /**
   * @param {any} text
   * @param {any} [options]
   * @returns {Promise<any>}
   */
  async embed(text, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error('embed() not implemented');
  }

  /**
   * @param {any} imageInput
   * @param {string} [prompt]
   * @returns {Promise<any>}
   */
  async vision(imageInput, prompt = '') { // eslint-disable-line no-unused-vars
    throw new Error('vision() not implemented');
  }

  async health() {
    return { ok: false, status: 'not implemented' };
  }

  async listModels() {
    return [];
  }
}

module.exports = BaseAdapter;
