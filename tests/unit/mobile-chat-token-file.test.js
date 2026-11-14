'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const {
  loadHeidiMobileTokenFromFile,
  isInsideRepo,
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

  it('isInsideRepo is case-insensitive on win32', () => {
    if (process.platform !== 'win32') return;
    const upper = path.join(ROOT, 'LIB', 'Mobile-Chat', 'token-file.js');
    expect(isInsideRepo(upper, ROOT)).toBe(true);
    expect(isInsideRepo(ROOT.toUpperCase(), ROOT)).toBe(true);
  });

  it('isInsideRepo resolves symlinks/junctions to real paths', () => {
    // A link outside the repo that points inside must still be refused.
    const link = path.join(tmpDir, 'repo-link');
    try {
      fs.symlinkSync(ROOT, link, 'junction');
    } catch {
      return; // symlink privilege unavailable — nothing to assert
    }
    expect(isInsideRepo(path.join(link, 'lib', 'x'), ROOT)).toBe(true);
  });

  it('rejects a UTF-16 encoded token file with a wrong-encoding log', () => {
    const tokenFile = path.join(tmpDir, 'token-utf16');
    fs.writeFileSync(tokenFile, SECRET, 'utf16le');
    const env = { HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const logs = [];
    const result = loadHeidiMobileTokenFromFile({
      repoRoot: ROOT,
      env,
      logError: (m) => logs.push(m),
      logInfo: (m) => logs.push(m),
    });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('file_bad_encoding');
    expect(env.HEIDI_MOBILE_TOKEN).toBeUndefined();
    expect(logs.join('\n')).toMatch(/wrong encoding/);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('rejects a token containing NUL bytes', () => {
    const tokenFile = path.join(tmpDir, 'token-nul');
    fs.writeFileSync(tokenFile, Buffer.from([0x41, 0x00, 0x42, 0x00, 0x0a]));
    const env = { HEIDI_MOBILE_TOKEN_FILE: tokenFile };
    const result = loadHeidiMobileTokenFromFile({ repoRoot: ROOT, env });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('file_bad_encoding');
    expect(env.HEIDI_MOBILE_TOKEN).toBeUndefined();
  });

  it('logs unreadable separately from missing', () => {
    // A directory at the token path exists but cannot be read as a file.
    const dirAsFile = path.join(tmpDir, 'not-a-file');
    fs.mkdirSync(dirAsFile);
    const env = { HEIDI_MOBILE_TOKEN_FILE: dirAsFile };
    const logs = [];
    const result = loadHeidiMobileTokenFromFile({
      repoRoot: ROOT,
      env,
      logError: (m) => logs.push(m),
      logInfo: (m) => logs.push(m),
    });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('file_unreadable');
    const joined = logs.join('\n');
    expect(joined).toMatch(/unreadable/);
    expect(joined).not.toMatch(/token file missing/);
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