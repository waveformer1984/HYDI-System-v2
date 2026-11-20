'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { LocalModelClient } = require('../../api/local-model');

const CONFIG_DIR = path.join(process.cwd(), 'config', 'makeready');
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

const ACCESS_VALUE_SEP = '(?:\\s+is\\s*|\\s*[=:#-]\\s*|\\s+)';

const ACCESS_PATTERNS = [
  new RegExp(`lockbox(?:\\s+code)?${ACCESS_VALUE_SEP}[\\w-]+`, 'gi'),
  new RegExp(`gate\\s+code${ACCESS_VALUE_SEP}[\\w-]+`, 'gi'),
  new RegExp(`door\\s+code${ACCESS_VALUE_SEP}[\\w-]+`, 'gi'),
  new RegExp(`\\bkeypad${ACCESS_VALUE_SEP}[\\w-]+`, 'gi'),
  new RegExp(`\\baccess\\s+code${ACCESS_VALUE_SEP}[\\w-]+`, 'gi'),
];

const OWNER_CONFIRM = 'the owner will confirm';

function loadConfig(slug) {
  if (!slug || !SLUG_RE.test(slug)) {
    const err = new Error('invalid_slug');
    err.code = 'INVALID_SLUG';
    throw err;
  }
  const file = path.join(CONFIG_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) {
    const err = new Error('config_not_found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.price_points) {
    const err = new Error('missing_price_points');
    err.code = 'CONFIG_INVALID';
    throw err;
  }
  return raw;
}

function redactAccessCodes(text) {
  if (!text || typeof text !== 'string') return { text: text || '', redacted: false };
  let redacted = false;
  let out = text;
  for (const pattern of ACCESS_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(out)) redacted = true;
    out = out.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED]');
  }
  return { text: out, redacted };
}

function computeEstimate(config, input) {
  const pp = config.price_points;
  const phases = Array.isArray(input.phases) ? input.phases : [];
  const sqFt = Number(input.sq_ft ?? input.sqFt);
  const stories = Number(input.stories) || 1;
  const addOnIds = Array.isArray(input.add_ons) ? input.add_ons : [];

  if (!Number.isFinite(sqFt) || sqFt <= 0) {
    return { ok: false, error: 'invalid_sq_ft' };
  }
  if (phases.length === 0) {
    return { ok: false, error: 'phases_required' };
  }

  const storyKey = String(stories);
  const mult =
    (pp.story_multipliers && (pp.story_multipliers[storyKey] ?? pp.story_multipliers.default)) || 1;

  const lines = [];
  let subtotal = 0;

  for (const phase of phases) {
    const phaseCfg = pp.phases && pp.phases[phase];
    const rate = phaseCfg && phaseCfg.per_sqft;
    if (rate == null || !Number.isFinite(Number(rate))) {
      return { ok: false, error: 'missing_rate', phase };
    }
    const amount = Math.round(sqFt * Number(rate) * mult * 100) / 100;
    lines.push({ phase, per_sqft: Number(rate), sq_ft: sqFt, story_multiplier: mult, amount });
    subtotal += amount;
  }

  const addons = pp.add_ons || [];
  for (const id of addOnIds) {
    const addon = addons.find((a) => a.id === id);
    if (!addon) continue;
    const price = Number(addon.price);
    if (!Number.isFinite(price)) {
      return { ok: false, error: 'missing_rate', add_on: id };
    }
    lines.push({ add_on: id, label: addon.label, amount: price });
    subtotal += price;
  }

  const minimum = Number(pp.minimum_charge);
  if (Number.isFinite(minimum) && subtotal < minimum) {
    lines.push({ adjustment: 'minimum_charge', amount: minimum - subtotal });
    subtotal = minimum;
  }

  const totalCents = Math.round(subtotal * 100);
  return {
    ok: true,
    estimate_cents: totalCents,
    estimate_usd: subtotal,
    lines,
    label: 'estimate, final quote confirmed by owner',
  };
}

function buildConfigContext(config) {
  const services = (config.services || []).map((s) => `- ${s}`).join('\n');
  const policies = (config.policies || []).map((p) => `- ${p}`).join('\n');
  return [
    `Company: ${config.display_name || config.slug}`,
    `Service area: ${config.service_area || OWNER_CONFIRM}`,
    `Lead time: ${config.lead_time || OWNER_CONFIRM}`,
    `Insurance / bonding: ${config.insurance_statement || OWNER_CONFIRM}`,
    `Services:\n${services || '- ' + OWNER_CONFIRM}`,
    `Policies:\n${policies || '- ' + OWNER_CONFIRM}`,
    'If the user asks for anything not listed above, reply exactly: "the owner will confirm".',
    'Never invent prices. For pricing, direct them to use the estimate form with sq ft and phases.',
    'Never ask for or store lockbox, gate, or door codes. If they mention access codes, say: send access info by phone.',
  ].join('\n');
}

async function chatReply(config, message) {
  const { text: redactedMsg, redacted } = redactAccessCodes(String(message || ''));
  const client = new LocalModelClient();
  let llmUp = false;
  try {
    llmUp = await client.isAvailable();
  } catch {
    llmUp = false;
  }

  const accessNote = redacted
    ? 'send access info by phone'
    : null;

  if (!llmUp) {
    return {
      mode: 'form',
      reply: 'Our assistant is in form mode right now — you can still request an estimate and submit your lots below.',
      accessNote,
      redacted,
    };
  }

  const system = buildConfigContext(config);
  const prompt = `${system}\n\nUser: ${redactedMsg}\n\nAssistant:`;
  try {
    const gen = await client.generate(prompt, { max_tokens: 400, temperature: 0.3 });
    let reply = (gen.text || '').trim() || OWNER_CONFIRM;
    if (redacted) {
      reply = `${reply}\n\nsend access info by phone`;
    }
    return { mode: 'chat', reply, accessNote, redacted, model: client.model };
  } catch {
    return {
      mode: 'form',
      reply: 'Our assistant is in form mode right now — you can still request an estimate and submit your lots below.',
      accessNote,
      redacted,
    };
  }
}

function newRequestId() {
  return `mr_${crypto.randomBytes(8).toString('hex')}`;
}

function validateLot(lot, index) {
  const required = [
    'lot_number',
    'address',
    'phases',
    'sq_ft',
    'stories',
    'target_date',
    'closing_date',
  ];
  const missing = required.filter((k) => {
    const v = lot[k];
    if (k === 'phases') return !Array.isArray(v) || v.length === 0;
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length) {
    return { ok: false, error: 'missing_fields', lot_index: index, fields: missing };
  }
  return { ok: true };
}

function normalizeSubmission(body) {
  const shared = {
    builder_company: body.builder_company,
    contact_name: body.contact_name,
    phone: body.phone,
    email: body.email,
    community: body.community,
    po_number: body.po_number || null,
  };

  const lots = Array.isArray(body.lots) ? body.lots : [body.lot || body];
  return { shared, lots };
}

function buildRows(slug, shared, lots, requestId) {
  const rows = [];
  for (let i = 0; i < lots.length; i += 1) {
    const lot = lots[i];
    const check = validateLot(lot, i);
    if (!check.ok) return check;

    const notes = redactAccessCodes(lot.notes || '');
    const est = computeEstimate(
      { price_points: lot._price_points || lot.price_points },
      lot,
    );
    if (!est.ok) {
      if (est.error === 'missing_rate') {
        return { ok: false, error: 'missing_rate', lot_index: i, phase: est.phase };
      }
      return { ok: false, error: est.error, lot_index: i };
    }
    rows.push({
      request_id: requestId,
      company_slug: slug,
      builder_company: shared.builder_company,
      contact_name: shared.contact_name,
      phone: shared.phone,
      email: shared.email,
      community: shared.community,
      lot_number: String(lot.lot_number),
      address: String(lot.address),
      phases: lot.phases,
      sq_ft: Number(lot.sq_ft),
      stories: Number(lot.stories),
      target_date: lot.target_date,
      closing_date: lot.closing_date,
      po_number: shared.po_number,
      notes: notes.text,
      access_redacted: notes.redacted,
      estimate_cents: est.estimate_cents,
      estimate_breakdown: est.lines,
    });
  }
  return { ok: true, rows, access_redacted: rows.some((r) => r.access_redacted) };
}

function buildRowsWithConfig(slug, config, shared, lots, requestId) {
  const withPricing = lots.map((lot) => ({ ...lot, _price_points: config.price_points }));
  return buildRows(slug, shared, withPricing, requestId);
}

async function sendOwnerEmail(config, requestId, rows) {
  const to = config.owner_email;
  const smtpPass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  if (!to || !process.env.SMTP_USER || !smtpPass) {
    return { sent: false, reason: 'smtp_not_configured' };
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass,
    },
  });

  const summary = rows
    .map((r) => {
      const price =
        r.estimate_cents != null
          ? `${(r.estimate_cents / 100).toFixed(2)} USD (estimate)`
          : 'price confirmed by owner';
      return `Lot ${r.lot_number} @ ${r.address} — ${price}`;
    })
    .join('\n');

  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"MakeReady Bot" <noreply@protoforge.dev>',
    to,
    subject: `[MakeReady] New request ${requestId} (${rows.length} lot${rows.length > 1 ? 's' : ''})`,
    text: [
      `New make-ready request: ${requestId}`,
      `Builder: ${rows[0].builder_company}`,
      `Contact: ${rows[0].contact_name} | ${rows[0].phone} | ${rows[0].email}`,
      '',
      summary,
      '',
      'Final quote confirmed by owner.',
    ].join('\n'),
  });
  return { sent: true };
}

function publicConfig(config) {
  return {
    slug: config.slug,
    display_name: config.display_name,
    demo: Boolean(config.demo),
    service_area: config.service_area,
    lead_time: config.lead_time,
    insurance_statement: config.insurance_statement,
    services: config.services,
    policies: config.policies,
    phases_available: Object.keys((config.price_points && config.price_points.phases) || {}),
    add_ons: (config.price_points && config.price_points.add_ons) || [],
    stripe_payment_link: config.stripe_payment_link || '',
  };
}

module.exports = {
  SLUG_RE,
  loadConfig,
  redactAccessCodes,
  computeEstimate,
  chatReply,
  buildConfigContext,
  newRequestId,
  normalizeSubmission,
  buildRowsWithConfig,
  validateLot,
  sendOwnerEmail,
  publicConfig,
  OWNER_CONFIRM,
};