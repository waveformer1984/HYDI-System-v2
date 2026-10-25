'use strict';
// Miniature of scripts/heidi-daemon-launcher.js: hooks require() through
// tsx/cjs, then loads a TypeScript entry that performs an extensionless
// `await import('./target')` — the exact pattern that fails inside
// hydi-daemon without `node --import tsx`.
require('tsx/cjs');
require('./entry.ts');
