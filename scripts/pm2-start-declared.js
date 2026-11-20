#!/usr/bin/env node
'use strict';
/**
 * Start PM2 apps declared in ecosystem.config.js except those with autostart: false.
 * Idempotent — safe after `pm2 resurrect` in start-heidi-everything.ps1.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { pm2StartOnlyArgs } = require('../lib/runtime/ecosystem-autostart');

const ROOT = path.resolve(__dirname, '..');
const cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
const result = spawnSync(cmd, pm2StartOnlyArgs(ROOT), {
  cwd: ROOT,
  encoding: 'utf8',
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);