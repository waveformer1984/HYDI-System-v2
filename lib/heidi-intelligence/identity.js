'use strict';

const fs = require('fs');
const path = require('path');

let cached = null;

function repoRoot() {
  return process.env.HYDI_REPO_ROOT || path.resolve(__dirname, '..', '..');
}

function loadIdentity() {
  if (cached) return cached;
  const file = path.join(repoRoot(), 'config', 'heidi-intelligence', 'identity.json');
  const raw = fs.readFileSync(file, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

/** Model-agnostic system preamble — identity does not depend on the foundation model. */
function buildIdentitySystemBlock() {
  const id = loadIdentity();
  const principles = (id.principles || []).map((p) => `- ${p}`).join('\n');
  return [
    `You are ${id.displayName} (${id.id} v${id.version}). ${id.role}.`,
    'Behavioral principles:',
    principles,
    `Tone: ${id.tone?.style || 'direct'}. Avoid: ${(id.tone?.avoid || []).join(', ')}.`,
    'You are not your underlying model. Your identity and obligations persist across sessions and devices via structured memory, not raw chat logs alone.',
  ].join('\n');
}

module.exports = { loadIdentity, buildIdentitySystemBlock, repoRoot };