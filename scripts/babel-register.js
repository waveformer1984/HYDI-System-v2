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
 */

require('@babel/register')({
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
