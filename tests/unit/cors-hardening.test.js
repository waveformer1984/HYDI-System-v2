const { handleCors, getAllowedOrigin } = require('../../lib/cors');

function mockRes() {
  const headers = {};
  let status = 200;
  let ended = false;
  const body = [];

  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
    get statusCode() {
      return status;
    },
    set statusCode(value) {
      status = value;
    },
    end(data) {
      ended = true;
      if (data) body.push(data);
    },
    _ended() { return ended; },
    _body() { return Buffer.concat(body.map(b => Buffer.from(b))).toString(); },
  };
}

describe('cors hardening', () => {
  const previous = process.env.MOBILE_CHAT_ORIGIN;

  afterEach(() => {
    process.env.MOBILE_CHAT_ORIGIN = previous;
  });

  it('allows the configured origin', () => {
    process.env.MOBILE_CHAT_ORIGIN = 'http://localhost:3000';
    const req = { method: 'POST', headers: { origin: 'http://localhost:3000' } };
    const res = mockRes();
    const ok = handleCors(req, res);
    expect(ok).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(res.headers['Vary']).toBe('Origin');
  });

  it('rejects an unexpected origin with 403', () => {
    process.env.MOBILE_CHAT_ORIGIN = 'http://localhost:3000';
    const req = { method: 'POST', headers: { origin: 'https://evil.example' } };
    const res = mockRes();
    const ok = handleCors(req, res);
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res._ended()).toBe(true);
  });

  it('rejects preflight from an unexpected origin', () => {
    process.env.MOBILE_CHAT_ORIGIN = 'http://localhost:3000';
    const req = { method: 'OPTIONS', headers: { origin: 'https://evil.example' } };
    const res = mockRes();
    const ok = handleCors(req, res, { allowedMethods: 'POST, OPTIONS' });
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res._ended()).toBe(true);
  });

  it('permits wildcard when explicitly configured', () => {
    process.env.MOBILE_CHAT_ORIGIN = '*';
    const req = { method: 'POST', headers: { origin: 'https://any.origin' } };
    const res = mockRes();
    const ok = handleCors(req, res);
    expect(ok).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('defaults to localhost:3000 when no env var is set', () => {
    delete process.env.MOBILE_CHAT_ORIGIN;
    expect(getAllowedOrigin()).toBe('http://localhost:3000');
  });
});
