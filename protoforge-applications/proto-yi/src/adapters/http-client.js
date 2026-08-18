class FetchClient {
  constructor(endpoint, options = {}) {
    this.endpoint = (endpoint || 'http://localhost:5000').replace(/\/$/, '');
    this.timeout = options.timeout || 5000;
    this.logger = options.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  async get(path) {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      this.logger.debug('http-client', 'get', url);
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      const data = await this._parse(res);
      if (!res.ok) throw new Error(`Proto.I.Y engine GET ${path} returned ${res.status}: ${data.error || ''}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async post(path, body) {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      this.logger.debug('http-client', 'post', { url, body });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await this._parse(res);
      if (!res.ok) throw new Error(`Proto.I.Y engine POST ${path} returned ${res.status}: ${data.error || ''}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async _parse(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (err) {
      return { raw: text };
    }
  }
}

function createFetchClient(endpoint, options = {}) {
  return new FetchClient(endpoint, options);
}

module.exports = { FetchClient, createFetchClient };
