'use strict';
/**
 * Runtime TypeScript loader for HYDI operational CLI scripts.
 *
 * The operational intelligence library (`lib/operational/*.ts`) is authored in
 * TypeScript and transpiled by babel-jest during tests. The CLI scripts
 * (`hydi:diagnose`, `hydi:recover`) run under plain Node, so they require this
 * bootstrap FIRST to install @babel/register with the SAME presets Jest uses.
 *
 * This guarantees test-runtime parity: the code exercised by the unit tests is
 * the code that runs in production CLI invocations. Without this, `require()`
 * of a `.ts` file throws `MODULE_NOT_FOUND` — a "false green" where tests pass
 * but the CLI is unreachable at runtime.
 *
 * Presets mirror `babel.jest.config.js` exactly.
 *
 * Inside Jest this is a no-op: babel-jest already transforms these files, and
 * @babel/register's hook is process-global (pirates patches Module._extensions).
 * Installed from a test's module sandbox, it outlives that sandbox and later
 * intercepts Jest's own native requires (e.g. the coverage reporter loading
 * istanbul-lib-report after all suites finish). Babel then lazy-requires its
 * helpers through the torn-down sandbox and crashes the run with
 * "isBrowsersQueryValid is not a function". `jest` is injected into every
 * module Jest loads, but not into child processes a test may spawn, so those
 * still get the loader.
 */

// eslint-disable-next-line no-undef
if (typeof jest === 'undefined') require('@babel/register')({
  extensions: ['.ts', '.js', '.jsx', '.tsx'],
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
  // Ignore node_modules — only transpile project TS.
  ignore: [/node_modules/],
  // Cache transpiled output for faster subsequent invocations.
  cache: true,
});
