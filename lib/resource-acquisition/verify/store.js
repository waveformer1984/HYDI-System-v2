'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function evidenceDir() {
  const root = process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..', '..');
  return path.join(root, '.runtime', 'resource-discovery', 'evidence');
}

function persistVerificationRecord(opportunityId, payload) {
  fs.mkdirSync(evidenceDir(), { recursive: true });
  const file = path.join(evidenceDir(), `${opportunityId}_${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

module.exports = { evidenceDir, persistVerificationRecord };