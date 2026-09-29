/**
 * Safe child-process environment construction (red-team 2026-09-18).
 * ---------------------------------------------------------------------------
 * The hole this closes: adapters merged caller-supplied `parameters.env` into
 * the child environment verbatim. Environment variables ARE code execution
 * for the allowlisted toolchains:
 *
 *   NODE_OPTIONS='--require ./evil.js'   -> node/npm/npx load attacker code
 *   GIT_SSH_COMMAND / GIT_EXEC_PATH      -> git runs an attacker executable
 *   npm_config_* / npm_scripts env       -> npm behaviour subversion
 *   PATH / PATHEXT / ComSpec / SHELL     -> executable-resolution hijack
 *   LD_PRELOAD / DYLD_INSERT_LIBRARIES   -> library injection on POSIX
 *   BROWSER                              -> `npm open`-style command launch
 *   HTTP(S)_PROXY                        -> traffic redirection
 *
 * An allowlist, not a denylist: only variables that cannot influence code
 * loading, resolution, or network egress may be overridden at all. Anything
 * else is rejected loudly rather than silently stripped — a caller sending
 * NODE_OPTIONS is either malicious or buggy and deserves the error.
 */

const BENIGN_ENV_KEYS = new Set([
  'CI',
  'FORCE_COLOR',
  'NO_COLOR',
  'COLORTERM',
  'TERM',
  'TZ',
  'LANG',
  'LC_ALL',
]);

/**
 * Build a child-process environment: the adapter's own environment plus any
 * caller overrides that are provably benign. Throws if the caller asks to
 * set anything outside the benign set — comparison is case-insensitive
 * because env keys are case-insensitive on Windows.
 */
export function buildChildEnv(callerEnv: unknown): NodeJS.ProcessEnv {
  if (callerEnv === undefined || callerEnv === null) {
    return { ...process.env };
  }
  if (typeof callerEnv !== 'object' || Array.isArray(callerEnv)) {
    throw new Error('env override must be an object of key/value pairs');
  }
  const entries = Object.entries(callerEnv as Record<string, unknown>);
  const denied: string[] = [];
  const accepted: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!BENIGN_ENV_KEYS.has(key.toUpperCase())) {
      denied.push(key);
      continue;
    }
    if (typeof value !== 'string') {
      denied.push(`${key} (non-string value)`);
      continue;
    }
    accepted[key] = value;
  }
  if (denied.length > 0) {
    throw new Error(
      `env override denied for: ${denied.join(', ')} — only benign display/locale flags ` +
      `(${Array.from(BENIGN_ENV_KEYS).join(', ')}) may be set; env vars that influence ` +
      'code loading, executable resolution, or egress are not permitted',
    );
  }
  return { ...process.env, ...accepted };
}
