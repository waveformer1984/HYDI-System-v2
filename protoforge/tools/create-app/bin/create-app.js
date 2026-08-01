#!/usr/bin/env node

const path = require('path');
const { generate } = require('../src/generator');

const name = process.argv[2];
const force = process.argv.includes('--force');

if (!name) {
  console.error('Usage: npx create-protoforge-app <app-name> [--force]');
  process.exit(1);
}

const result = generate(name, {
  cwd: path.resolve(__dirname, '..', '..', '..'),
  force
});

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(`Created ProtoForge application "${result.appName}" in ${result.targetDir}`);
console.log(`Suggested port: ${result.port}`);
