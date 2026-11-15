'use strict';

const fs = require('fs');
const path = require('path');
const { corpusDir } = require('./dataset-pipeline');

const EXPERIMENTAL_FLAG = 'HEIDI_FINETUNE_EXPERIMENTAL';

function experimentalEnabled(env = process.env) {
  return String(env[EXPERIMENTAL_FLAG] || '').toLowerCase() === 'true';
}

/**
 * Experimental LoRA/SFT pathway — isolated from production models; manifest only until data volume threshold met.
 */
function buildFinetuneManifest({ minSamples = 500, env = process.env } = {}) {
  if (!experimentalEnabled(env)) {
    return { ok: false, reason: `${EXPERIMENTAL_FLAG}_not_true`, productionImpact: 'none' };
  }
  const corpusFile = path.join(corpusDir(), 'interactions.jsonl');
  let sampleCount = 0;
  if (fs.existsSync(corpusFile)) {
    const data = fs.readFileSync(corpusFile, 'utf8');
    sampleCount = data.split('\n').filter(Boolean).length;
  }
  const dir = path.join(corpusDir(), 'experimental');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    pathway: 'lora_or_sft',
    isolated: true,
    productionModel: 'unchanged',
    sampleCount,
    minSamples,
    ready: sampleCount >= minSamples,
    rollback: 'disable experimental flag; production router unchanged',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'finetune-manifest.json'), JSON.stringify(manifest, null, 2));
  return { ok: true, manifest };
}

module.exports = { experimentalEnabled, buildFinetuneManifest };