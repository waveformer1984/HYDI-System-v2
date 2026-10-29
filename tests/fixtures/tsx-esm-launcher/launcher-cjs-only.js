'use strict';
// The OLD launcher shape, kept to prove tsx/cjs alone is not enough:
// require() is hooked but import() is not, so the extensionless dynamic
// import in entry.ts still fails without tsx/esm/api.register().
require('tsx/cjs');
require('./entry.ts');
