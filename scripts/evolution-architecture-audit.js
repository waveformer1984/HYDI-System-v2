#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { buildArchitectureAudit } = require('../lib/evolution-engine/architecture-audit');

const repoRoot = process.env.HYDI_REPO_ROOT || path.join(__dirname, '..');
const audit = buildArchitectureAudit(repoRoot);
const outDir = path.join(repoRoot, '.runtime', 'evolution');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'architecture-audit.json');
fs.writeFileSync(outFile, JSON.stringify(audit, null, 2));
console.log(JSON.stringify({ ok: true, path: outFile, base_sha: audit.base_sha }, null, 2));
