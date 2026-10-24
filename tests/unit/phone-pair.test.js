'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  createPhonePairHandler,
  isPairingNetwork,
  resetPhonePairRateLimit,
} = require('../../lib/billing/phone-pair-route');
const { replacePhoneToken } = require('../../termux/store-phone-token');

const HUMAN_TOKEN = 'human-board-token-value';
const PHONE_TOKEN = 'phone-read-token-value';

function response() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.status = (statusCode) => { res.statusCode = statusCode; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function request({ ip = '192.168.1.20', authorization, forwardedFor, method = 'GET' } = {}) {
  return {
    method,
    socket: { remoteAddress: ip },
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
  };
}

describe('GET /api/phone/pair', () => {
  beforeEach(() => resetPhonePairRateLimit());

  it('requires the human board bearer token', () => {
    const logger = { info: jest.fn() };
    const handler = createPhonePairHandler({
      env: { HYDI_BOARD_HUMAN_TOKEN: HUMAN_TOKEN, HYDI_PHONE_READ_TOKEN: PHONE_TOKEN },
      logger,
      now: () => Date.parse('2026-10-23T12:00:00Z'),
    });
    for (const authorization of [undefined, 'Bearer wrong-token-value']) {
      const res = response();
      handler(request({ authorization }), res);
      expect(res.statusCode).toBe(401);
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(HUMAN_TOKEN);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(PHONE_TOKEN);
  });

  it('uses only the real socket address for its network allowlist', () => {
    expect(isPairingNetwork('127.0.0.1')).toBe(true);
    expect(isPairingNetwork('::1')).toBe(true);
    expect(isPairingNetwork('192.168.86.20')).toBe(true);
    expect(isPairingNetwork('100.64.0.1')).toBe(true);
    expect(isPairingNetwork('100.127.255.254')).toBe(true);
    expect(isPairingNetwork('100.128.0.1')).toBe(false);
    expect(isPairingNetwork('8.8.8.8')).toBe(false);

    const handler = createPhonePairHandler({
      env: { HYDI_BOARD_HUMAN_TOKEN: HUMAN_TOKEN, HYDI_PHONE_READ_TOKEN: PHONE_TOKEN },
      logger: { info: jest.fn() },
    });
    const denied = response();
    handler(request({
      ip: '8.8.8.8',
      forwardedFor: '192.168.1.20',
      authorization: `Bearer ${HUMAN_TOKEN}`,
    }), denied);
    expect(denied.statusCode).toBe(404);
  });

  it('allows five requests per minute per socket IP and then rate-limits', () => {
    const handler = createPhonePairHandler({
      env: { HYDI_BOARD_HUMAN_TOKEN: HUMAN_TOKEN, HYDI_PHONE_READ_TOKEN: PHONE_TOKEN },
      logger: { info: jest.fn() },
      now: () => 1_800_000_000_000,
    });
    for (let index = 0; index < 5; index += 1) {
      const res = response();
      handler(request({ authorization: `Bearer ${HUMAN_TOKEN}` }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ token: PHONE_TOKEN });
    }
    const limited = response();
    handler(request({ authorization: `Bearer ${HUMAN_TOKEN}` }), limited);
    expect(limited.statusCode).toBe(429);

    const otherIp = response();
    handler(request({ ip: '192.168.1.21', authorization: `Bearer ${HUMAN_TOKEN}` }), otherIp);
    expect(otherIp.statusCode).toBe(200);
  });

  it('sets no-store and audits outcome without logging either token', () => {
    const logger = { info: jest.fn() };
    const handler = createPhonePairHandler({
      env: { HYDI_BOARD_HUMAN_TOKEN: HUMAN_TOKEN, HYDI_PHONE_READ_TOKEN: PHONE_TOKEN },
      logger,
      now: () => Date.parse('2026-10-23T12:00:00Z'),
    });
    const res = response();
    handler(request({ authorization: `Bearer ${HUMAN_TOKEN}` }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    const logs = logger.info.mock.calls.flat().join('\n');
    expect(logs).toContain('2026-10-23T12:00:00.000Z');
    expect(logs).toContain('ip=192.168.1.20 result=ok');
    expect(logs).not.toContain(HUMAN_TOKEN);
    expect(logs).not.toContain(PHONE_TOKEN);
  });

  it('returns 503 after authentication when the phone token is unset', () => {
    const res = response();
    createPhonePairHandler({
      env: { HYDI_BOARD_HUMAN_TOKEN: HUMAN_TOKEN },
      logger: { info: jest.fn() },
    })(request({ authorization: `Bearer ${HUMAN_TOKEN}` }), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('Termux phone-token replacement', () => {
  let directory;

  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-pair-')); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it('atomically replaces every prior token line, preserves settings, and sets mode 600', () => {
    const envFile = path.join(directory, 'thin-client.env');
    fs.writeFileSync(envFile, [
      'FRANK_HOSTS=192.168.1.2,100.100.1.2',
      'HYDI_PHONE_READ_TOKEN=old-token-value-1',
      'export HYDI_PHONE_READ_TOKEN=old-token-value-2',
      'HYDI_BOARD_HUMAN_TOKEN=human-token',
      '',
    ].join('\n'));
    replacePhoneToken(envFile, PHONE_TOKEN);
    const contents = fs.readFileSync(envFile, 'utf8');
    expect(contents).toContain('FRANK_HOSTS=192.168.1.2,100.100.1.2');
    expect(contents).toContain('HYDI_BOARD_HUMAN_TOKEN=human-token');
    expect(contents.match(/^HYDI_PHONE_READ_TOKEN=/gm)).toHaveLength(1);
    expect(contents).toContain(`HYDI_PHONE_READ_TOKEN=${PHONE_TOKEN}`);
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
  });

  it('stores a pair response without writing the token to stdout or stderr', () => {
    const responseFile = path.join(directory, 'response.json');
    const envFile = path.join(directory, 'thin-client.env');
    fs.writeFileSync(responseFile, JSON.stringify({ token: PHONE_TOKEN }), { mode: 0o600 });
    const run = spawnSync(process.execPath, [
      path.join(__dirname, '..', '..', 'termux', 'store-phone-token.js'),
      responseFile,
      envFile,
    ], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(`${run.stdout}${run.stderr}`).not.toContain(PHONE_TOKEN);
    expect(run.stdout).toBe('');
    expect(fs.readFileSync(envFile, 'utf8')).toContain(`HYDI_PHONE_READ_TOKEN=${PHONE_TOKEN}`);
  });
});
