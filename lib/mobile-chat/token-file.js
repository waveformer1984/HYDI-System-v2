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

function isInsideRepo(absolutePath, repoRoot) {
  const root = path.resolve(repoRoot);
  const target = path.resolve(absolutePath);
  if (target === root) return true;
  return target.startsWith(`${root}${path.sep}`);
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
    logError(`${LOG_PREFIX} heidi-mobile token file missing`);
    return { loaded: false, reason: 'file_unreadable' };
  }

  const token = raw.trim();
  if (token === '') {
    logError(`${LOG_PREFIX} heidi-mobile token file empty`);
    return { loaded: false, reason: 'file_empty' };
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