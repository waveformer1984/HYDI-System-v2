'use strict';

/**
 * Load HEIDI_MOBILE_TOKEN from a file when the env var is unset, so PM2
 * resurrect after reboot can start heidi-mobile-chat without a shell secret.
 * Never logs the token value.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PREFIX = '[heidi-mobile]';

function defaultTokenFilePath() {
  return path.join(os.homedir(), '.hydi', 'heidi-mobile-token');
}

function resolveRealPath(absolutePath) {
  // realpathSync needs the path to exist; for nonexistent targets resolve
  // the deepest existing ancestor and re-append the missing tail, so a
  // junction/symlinked ancestor is still resolved.
  let abs = path.resolve(absolutePath);
  const missing = [];
  while (!fs.existsSync(abs)) {
    const parent = path.dirname(abs);
    if (parent === abs) break;
    missing.unshift(path.basename(abs));
    abs = parent;
  }
  try {
    abs = fs.realpathSync(abs);
  } catch {
    // keep the lexical absolute path
  }
  return missing.length ? path.join(abs, ...missing) : abs;
}

function isInsideRepo(absolutePath, repoRoot) {
  let root = resolveRealPath(repoRoot);
  let target = resolveRealPath(absolutePath);
  // Win32 filesystems are case-insensitive; compare lowered so a differently
  // cased path cannot slip a repo-local token file past the refusal check.
  if (process.platform === 'win32') {
    root = root.toLowerCase();
    target = target.toLowerCase();
  }
  if (target === root) return true;
  return target.startsWith(`${root}${path.sep}`);
}

function hasNonPrintableChars(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // NUL or C0/C1 control chars — the signature of a UTF-16 file read as
    // UTF-8 (interleaved NUL bytes) or other binary content.
    if (code === 0x00 || (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function resolveTokenFilePath(env = process.env) {
  const explicit = env.HEIDI_MOBILE_TOKEN_FILE;
  if (explicit != null && String(explicit).trim() !== '') {
    return path.resolve(String(explicit).trim());
  }
  return defaultTokenFilePath();
}

/**
 * @param {{ repoRoot: string, env?: NodeJS.ProcessEnv, logError?: (msg: string) => void, logInfo?: (msg: string) => void }} opts
 * @returns {{ loaded: boolean, reason: string }}
 */
function loadHeidiMobileTokenFromFile(opts) {
  const env = opts.env || process.env;
  const logError = opts.logError || ((msg) => console.error(msg));
  const logInfo = opts.logInfo || ((msg) => console.log(msg));

  if (env.HEIDI_MOBILE_TOKEN != null && String(env.HEIDI_MOBILE_TOKEN).trim() !== '') {
    return { loaded: false, reason: 'env_set' };
  }

  const filePath = resolveTokenFilePath(env);
  if (isInsideRepo(filePath, opts.repoRoot)) {
    logError(`${LOG_PREFIX} HEIDI_MOBILE_TOKEN_FILE is inside the repository; refused`);
    return { loaded: false, reason: 'repo_path_refused' };
  }

  if (!fs.existsSync(filePath)) {
    logError(`${LOG_PREFIX} heidi-mobile token file missing`);
    return { loaded: false, reason: 'file_missing' };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    logError(`${LOG_PREFIX} heidi-mobile token file unreadable`);
    return { loaded: false, reason: 'file_unreadable' };
  }

  const token = raw.trim();
  if (token === '') {
    logError(`${LOG_PREFIX} heidi-mobile token file empty`);
    return { loaded: false, reason: 'file_empty' };
  }

  if (hasNonPrintableChars(token)) {
    logError(`${LOG_PREFIX} heidi-mobile token file has wrong encoding (NUL or non-printable characters); refused`);
    return { loaded: false, reason: 'file_bad_encoding' };
  }

  env.HEIDI_MOBILE_TOKEN = token;
  logInfo(`${LOG_PREFIX} HEIDI_MOBILE_TOKEN loaded from file`);
  return { loaded: true, reason: 'file_loaded' };
}

function applyHeidiMobileTokenFromFile(repoRoot) {
  return loadHeidiMobileTokenFromFile({ repoRoot, env: process.env });
}

module.exports = {
  defaultTokenFilePath,
  resolveTokenFilePath,
  isInsideRepo,
  loadHeidiMobileTokenFromFile,
  applyHeidiMobileTokenFromFile,
};