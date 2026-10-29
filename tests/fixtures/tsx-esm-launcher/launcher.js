'use strict';
// Miniature of scripts/heidi-daemon-launcher.js: hooks require() through
// tsx/cjs AND the ESM loader through tsx/esm/api.register(), then loads a
// TypeScript entry that performs an extensionless `await import('./target')`.
// With both hooks the import resolves under plain `node launcher.js` -
// no node_args needed.
require('tsx/cjs');
require('tsx/esm/api').register();
require('./entry.ts');
