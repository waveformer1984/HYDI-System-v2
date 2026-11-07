'use strict';

const fs = require('fs');
const path = require('path');
const { attachListenErrorHandler, mobileBindHost } = require('../../lib/governance/http-listen-guard');

const ROOT = path.resolve(__dirname, '..', '..');

const AUDITED = [
  'heidi-core/server.js',
  'launch-heidi-mobile.js',
  'api/hydi/sync.js',
  'src/server.js',
];

describe('http-server-security — audited surfaces', () => {
  for (const rel of AUDITED) {
    it(`${rel} does not set Access-Control-Allow-Origin: *`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/Access-Control-Allow-Origin['"],\s*'\*'/);
      expect(src).not.toMatch(/Access-Control-Allow-Origin',\s*'\*'/);
    });
  }

  it('launch-heidi-mobile uses mobileBindHost instead of hardcoded 0.0.0.0 listen', () => {
    const src = fs.readFileSync(path.join(ROOT, 'launch-heidi-mobile.js'), 'utf8');
    expect(src).toContain('mobileBindHost');
    expect(src).not.toMatch(/server\.listen\(PORT,\s*'0\.0\.0\.0'/);
  });

  it('mobileBindHost stays on loopback without HEIDI_MOBILE_TOKEN', () => {
    expect(mobileBindHost({})).toBe('127.0.0.1');
  });

  it('attachListenErrorHandler exits by default on EADDRINUSE', () => {
    const server = { on: jest.fn() };
    attachListenErrorHandler(server, { label: 'test', host: '127.0.0.1', port: 9 });
    expect(server.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('ecosystem.config.js — heidi-agent defaults', () => {
  it('documents HEIDI_ALLOW_EXEC=false and Ursula CORS origin', () => {
    const src = fs.readFileSync(path.join(ROOT, 'ecosystem.config.js'), 'utf8');
    expect(src).toMatch(/HEIDI_ALLOW_EXEC:\s*'false'/);
    expect(src).toMatch(/HEIDI_ADVISORY_ALLOWED_ORIGINS:\s*'http:\/\/127\.0\.0\.1:3100'/);
  });
});
