'use strict';

const fs = require('fs');
const path = require('path');
const { SLUG_RE } = require('./index');

const DEFAULT_SERVICES = [
  'Rough clean (post-framing / pre-drywall debris)',
  'Final clean (pre-closing detail)',
  'Touch-up before buyer walk',
];

const DEFAULT_POLICIES = [
  'Estimates are non-binding until the owner confirms scope on site.',
  'Access instructions must be shared by phone — never in chat.',
];

function configDir(override) {
  return override || process.env.MAKEREADY_CONFIG_DIR || path.join(process.cwd(), 'config', 'makeready');
}

function configPath(slug, dir) {
  return path.join(configDir(dir), `${slug}.json`);
}

function parsePhaseLines(lines) {
  const phases = {};
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const id = parts[0];
    const rate = Number(parts[1]);
    if (!id || !Number.isFinite(rate)) {
      return { ok: false, error: 'invalid_phase_line', line: trimmed };
    }
    if (rate <= 0) {
      return { ok: false, error: 'invalid_rate', phase: id, line: trimmed };
    }
    phases[id] = { per_sqft: rate };
  }
  if (Object.keys(phases).length === 0) {
    return { ok: false, error: 'phases_required' };
  }
  return { ok: true, phases };
}

function parseAddOnLines(lines) {
  const add_ons = [];
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    const pipe = trimmed.indexOf('|');
    if (pipe === -1) {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) return { ok: false, error: 'invalid_addon_line', line: trimmed };
      const price = Number(parts[parts.length - 1]);
      const id = parts[0];
      const label = parts.slice(1, -1).join(' ');
      if (price <= 0) return { ok: false, error: 'invalid_rate', add_on: id };
      add_ons.push({ id, label, price });
      continue;
    }
    const id = trimmed.slice(0, pipe).trim();
    const rest = trimmed.slice(pipe + 1).trim();
    const lastSpace = rest.lastIndexOf(' ');
    if (lastSpace === -1) return { ok: false, error: 'invalid_addon_line', line: trimmed };
    const label = rest.slice(0, lastSpace).trim();
    const price = Number(rest.slice(lastSpace + 1));
    if (!id || !label || !Number.isFinite(price) || price <= 0) {
      return { ok: false, error: 'invalid_addon_line', line: trimmed };
    }
    add_ons.push({ id, label, price });
  }
  return { ok: true, add_ons };
}

function validateStoryMultipliers(input) {
  const sm = input || {};
  const out = { default: 1 };
  for (const key of ['1', '2', '3']) {
    const v = Number(sm[key]);
    if (!Number.isFinite(v) || v <= 0) {
      return { ok: false, error: 'invalid_story_multiplier', story: key };
    }
    out[key] = v;
  }
  return { ok: true, story_multipliers: out };
}

function validateMinimumCharge(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'invalid_minimum_charge' };
  }
  return { ok: true, minimum_charge: n };
}

/**
 * Build config JSON from structured answers (CLI or tests).
 * @param {string} slug
 * @param {object} answers
 */
function buildConfigFromAnswers(slug, answers) {
  if (!slug || !SLUG_RE.test(slug)) {
    return { ok: false, error: 'invalid_slug' };
  }
  const phaseParsed = parsePhaseLines(answers.phase_lines || []);
  if (!phaseParsed.ok) return phaseParsed;

  const minimum = validateMinimumCharge(answers.minimum_charge);
  if (!minimum.ok) return minimum;

  const stories = validateStoryMultipliers({
    1: answers.story_multiplier_1,
    2: answers.story_multiplier_2,
    3: answers.story_multiplier_3,
  });
  if (!stories.ok) return stories;

  const addons = parseAddOnLines(answers.addon_lines || []);
  if (!addons.ok) return addons;

  const owner_email = String(answers.owner_email || '').trim();
  if (!owner_email) return { ok: false, error: 'missing_fields', fields: ['owner_email'] };

  const display_name = String(answers.display_name || '').trim();
  if (!display_name) return { ok: false, error: 'missing_fields', fields: ['display_name'] };

  const config = {
    slug,
    display_name,
    demo: Boolean(answers.demo),
    owner_email,
    service_area: String(answers.service_area || '').trim(),
    lead_time: String(answers.lead_time || '').trim(),
    insurance_statement: String(answers.insurance_statement || '').trim(),
    services: Array.isArray(answers.services) ? answers.services : DEFAULT_SERVICES,
    policies: Array.isArray(answers.policies) ? answers.policies : DEFAULT_POLICIES,
    stripe_payment_link: String(answers.stripe_payment_link || '').trim(),
    price_points: {
      minimum_charge: minimum.minimum_charge,
      story_multipliers: stories.story_multipliers,
      phases: phaseParsed.phases,
      add_ons: addons.add_ons,
    },
  };
  return { ok: true, config };
}

function writeCustomerConfig(slug, config, { force = false, configDir: dir } = {}) {
  const file = configPath(slug, dir);
  if (fs.existsSync(file) && !force) {
    return { ok: false, error: 'config_exists', path: file };
  }
  fs.mkdirSync(configDir(dir), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { ok: true, path: file };
}

function embedScriptSnippet(slug, apiBase = '') {
  const host = apiBase || 'https://YOUR_HOST';
  return [
    `<script src="${host}/makeready-bot/widget.js"`,
    `  data-slug="${slug}"`,
    `  data-api="${host}"></script>`,
  ].join('\n');
}

module.exports = {
  configPath,
  buildConfigFromAnswers,
  writeCustomerConfig,
  embedScriptSnippet,
  parsePhaseLines,
  parseAddOnLines,
  validateMinimumCharge,
  validateStoryMultipliers,
};