#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const TOKEN_LINE = /^[ \t]*(?:export[ \t]+)?HYDI_PHONE_READ_TOKEN=/;
const SAFE_TOKEN = /^[A-Za-z0-9._~-]{16,512}$/;

function replacePhoneToken(envFile, token) {
  if (!SAFE_TOKEN.test(String(token || ''))) throw new Error('pair response contained an invalid token');
  const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  const kept = existing.split(/\r?\n/).filter((line) => !TOKEN_LINE.test(line));
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  kept.push(`HYDI_PHONE_READ_TOKEN=${token}`, '');
  fs.mkdirSync(path.dirname(envFile), { recursive: true, mode: 0o700 });
  const temporary = `${envFile}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, kept.join('\n'), { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, envFile);
    fs.chmodSync(envFile, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* already renamed or never written */ }
  }
}

function storePairResponse(responseFile, envFile) {
  const payload = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
  replacePhoneToken(envFile, payload && payload.token);
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('response file and env file are required');
    storePairResponse(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(`phone token store failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

module.exports = { replacePhoneToken, storePairResponse };
