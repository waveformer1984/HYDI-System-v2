#!/usr/bin/env node

const { validate } = require('../src/validator');

const name = process.argv[2];

if (!name) {
  console.error('Usage: npx validate-app <app-name-or-path>');
  process.exit(1);
}

const result = validate(name);

if (!result.ok) {
  console.error('Validation failed:');
  for (const err of result.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`Validated ${result.manifest.name} v${result.manifest.version} at ${result.appDir}`);
if (result.warnings.length) {
  for (const w of result.warnings) {
    console.warn(`  warning: ${w}`);
  }
}
