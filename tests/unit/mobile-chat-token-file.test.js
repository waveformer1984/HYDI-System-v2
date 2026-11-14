'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  loadHeidiMobileTokenFromFile,
  isInsideRepo,
  isValidTokenContent,
  defaultTokenFilePath,
} = require('../../lib/mobile-chat/token-file');

const SECRET = 'super-secret-mobile-token-xyz';

describe('lib/mobile-chat/token-file.js', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heidi-mobile-token-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('env var wins over the file', () => {
    const tokenFile = path.join(tmpDir, 'token');
    fs.writeFileSync(tokenFile, `${SECRET}\n`);
    const env = { HEIDI_MOBILE_TOKEN: 'from-env-token-12', HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const logs = [];
    const result = loadHeidiMobileTokenFromFile({
      repoRoot: ROOT,
      env,
      logError: (m) => logs.push(m),
      logInfo: (m) => logs.push(m),
    });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('env_set');
    expect(env.HEIDI_MOBILE_TOKEN).toBe('from-env-token-12');
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('loads and trims token from file into env', () => {
    const tokenFile = path.join(tmpDir, 'token');
    fs.writeFileSync(tokenFile, `  ${SECRET}  \r\n`);
    const env = { HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const result = loadHeidiMobileTokenFromFile({ repoRoot: ROOT, env });
    expect(result.loaded).toBe(true);
    expect(env.HEIDI_MOBILE_TOKEN).toBe(SECRET);
  });

  it('treats missing file as not loaded', () => {
    const env = { HEIDI_MOBILE_TOKEN_FILE: path.join(tmpDir, 'nope') };
    const result = loadHeidiMobileTokenFromFile({ repoRoot: ROOT, env });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('file_missing');
    expect(env.HEIDI_MOBILE_TOKEN).toBeUndefined();
  });

  it('treats empty file as not loaded', () => {
    const tokenFile = path.join(tmpDir, 'empty');
    fs.writeFileSync(tokenFile, '   \n');
    const env = { HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const result = loadHeidiMobileTokenFromFile({ repoRoot: ROOT, env });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('file_empty');
    expect(env.HEIDI_MOBILE_TOKEN).toBeUndefined();
  });

  it('refuses a token file path inside the repo tree', () => {
    const inside = path.join(ROOT, '.hydi-test-token');
    const env = { HEIDI_MOBILE_TOKEN_FILE: inside };
    const result = loadHeidiMobileTokenFromFile({ repoRoot: ROOT, env });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('repo_path_refused');
  });

  it('never includes the token in log output', () => {
    const tokenFile = path.join(tmpDir, 'token');
    fs.writeFileSync(tokenFile, SECRET);
    const env = { HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const logs = [];
    loadHeidiMobileTokenFromFile({
      repoRoot: ROOT,
      env,
      logError: (m) => logs.push(m),
      logInfo: (m) => logs.push(m),
    });
    const joined = logs.join('\n');
    expect(joined).toMatch(/loaded from file/);
    expect(joined).not.toContain(SECRET);
    expect(joined).not.toContain('super-secret');
  });

  it('default path is under homedir .hydi', () => {
    expect(defaultTokenFilePath()).toBe(path.join(os.homedir(), '.hydi', 'heidi-mobile-token'));
  });

  it('isInsideRepo detects repo and external paths', () => {
    expect(isInsideRepo(ROOT, ROOT)).toBe(true);
    expect(isInsideRepo(path.join(ROOT, 'lib', 'x'), ROOT)).toBe(true);
    expect(isInsideRepo(tmpDir, ROOT)).toBe(false);
  });

  it('logs unreadable separately from missing', () => {
    const blocked = path.join(tmpDir, 'blocked');
    fs.mkdirSync(blocked);
    const env = { HEIDI_MOBILE_TOKEN_FILE: blocked };
    const logs = [];
    const result = loadHeidiMobileTokenFromFile({
      repoRoot: ROOT,
      env,
      logError: (m) => logs.push(m),
    });
    expect(result.reason).toBe('file_unreadable');
    expect(logs.join('\n')).toMatch(/unreadable/);
    expect(logs.join('\n')).not.toMatch(/file missing/);
  });

  it('rejects token with NUL or non-printable content (e.g. UTF-16 mis-read)', () => {
    const tokenFile = path.join(tmpDir, 'utf16ish');
    fs.writeFileSync(tokenFile, Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0x63, 0x00]));
    const env = { HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const logs = [];
    const result = loadHeidiMobileTokenFromFile({
      repoRoot: ROOT,
      env,
      logError: (m) => logs.push(m),
      logInfo: (m) => logs.push(m),
    });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('file_invalid');
    expect(env.HEIDI_MOBILE_TOKEN).toBeUndefined();
    const joined = logs.join('\n');
    expect(joined).toMatch(/invalid/i);
    expect(joined).not.toMatch(/loaded from file/);
    expect(joined).not.toContain('\0');
  });

  it('isValidTokenContent accepts printable ASCII and rejects controls', () => {
    expect(isValidTokenContent('good-token-12chars')).toBe(true);
    expect(isValidTokenContent('a\u0000b')).toBe(false);
    expect(isValidTokenContent('token\u200b')).toBe(false);
  });

  it('refuses repo path when only drive letter case differs on Windows', () => {
    if (process.platform !== 'win32') return;
    const drive = ROOT.slice(0, 2);
    if (drive[1] !== ':') return;
    const swapped = `${drive[0] === drive[0].toLowerCase() ? drive[0].toUpperCase() : drive[0].toLowerCase()}${drive.slice(1)}`;
    const altRoot = `${swapped}${ROOT.slice(2)}`;
    const inside = path.join(altRoot, 'lib', 'x');
    expect(isInsideRepo(inside, ROOT)).toBe(true);
  });
});

describe('launch-heidi-mobile.js token file + REQUIRE_TOKEN', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heidi-mobile-launch-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('still exits 78 when token required, file missing, env unset', () => {
    const env = { ...process.env, HEIDI_MOBILE_REQUIRE_TOKEN: '1', HEIDI_MOBILE_PORT: '0', HEIDI_MOBILE_TOKEN_FILE: path.join(tmpDir, 'missing') };
    delete env.HEIDI_MOBILE_TOKEN;
    const r = spawnSync(process.execPath, ['launch-heidi-mobile.js'], {
      cwd: ROOT,
      env,
      timeout: 20000,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/refusing to start without device login/);
    expect(r.stderr + r.stdout).not.toContain(SECRET);
  });

  it('does not exit 78 when token is loaded from file', () => {
    const tokenFile = path.join(tmpDir, 'token');
    fs.writeFileSync(tokenFile, 'file-based-token-12chars');
    const env = {
      ...process.env,
      HEIDI_MOBILE_REQUIRE_TOKEN: '1',
      HEIDI_MOBILE_PORT: '0',
      HEIDI_MOBILE_TOKEN_FILE: tokenFile,
    };
    delete env.HEIDI_MOBILE_TOKEN;
    const r = spawnSync(process.execPath, ['launch-heidi-mobile.js'], {
      cwd: ROOT,
      env,
      timeout: 3000,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(r.status).not.toBe(78);
    const combined = `${r.stderr || ''}\n${r.stdout || ''}`;
    expect(combined).toMatch(/loaded from file/);
    expect(combined).not.toContain('file-based-token-12chars');
  });
});