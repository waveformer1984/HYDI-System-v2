'use strict';

const fs = require('fs');
const path = require('path');

const NICHE_DIR = path.join(__dirname, '..', 'niches');
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateConfig(config, source = 'niche config') {
  if (!config || typeof config !== 'object') throw new Error(`${source}: expected an object`);
  if (!SLUG_RE.test(String(config.id || ''))) throw new Error(`${source}: invalid id`);
  for (const field of ['search_terms', 'business_categories', 'qualifying_signals', 'disqualifiers']) {
    if (!Array.isArray(config[field]) || config[field].length === 0) throw new Error(`${source}: ${field} must be a non-empty array`);
  }
  if (typeof config.why_theyd_buy !== 'string' || !config.why_theyd_buy.trim()) {
    throw new Error(`${source}: why_theyd_buy is required`);
  }
  for (const signal of config.qualifying_signals) {
    if (!signal || typeof signal.id !== 'string' || !Number.isFinite(signal.weight)) {
      throw new Error(`${source}: every qualifying signal needs id and numeric weight`);
    }
  }
  return config;
}

function loadNiche(id, { nicheDir = NICHE_DIR } = {}) {
  if (!SLUG_RE.test(String(id || ''))) throw new Error('invalid niche id');
  const file = path.join(nicheDir, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`unknown niche: ${id}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = validateConfig(parsed, file);
  if (config.id !== id) throw new Error(`${file}: id must match filename`);
  return config;
}

function listNiches({ nicheDir = NICHE_DIR } = {}) {
  return fs.readdirSync(nicheDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => loadNiche(name.slice(0, -5), { nicheDir }));
}

module.exports = { NICHE_DIR, loadNiche, listNiches, validateConfig };
