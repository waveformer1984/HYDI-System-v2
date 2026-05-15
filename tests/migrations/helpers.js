'use strict';
const fs = require('fs');
const path = require('path');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
function readMigration(filename) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
}
module.exports = { readMigration, MIGRATIONS_DIR };
