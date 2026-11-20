'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.cwd(), 'config', 'makeready');
const OFFER_FILE = path.join(CONFIG_DIR, 'platform-offer.json');
const DEMO_SLUG = 'demo-makeready-co';

function loadPlatformOffer() {
  if (!fs.existsSync(OFFER_FILE)) {
    return { setup_cents: null, monthly_cents: null, stripe_payment_link: '' };
  }
  const raw = JSON.parse(fs.readFileSync(OFFER_FILE, 'utf8'));
  return {
    setup_cents: raw.setup_cents ?? null,
    monthly_cents: raw.monthly_cents ?? null,
    stripe_payment_link: raw.stripe_payment_link || '',
  };
}

function formatUsdFromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
}

/** Public-facing pricing labels — never invents amounts. */
function offerPricingLabels(offer = loadPlatformOffer()) {
  const setup = formatUsdFromCents(offer.setup_cents);
  const monthly = formatUsdFromCents(offer.monthly_cents);
  const hasBoth = Boolean(setup && monthly);
  return {
    setup,
    monthly,
    showContactOnly: !hasBoth,
    stripe_payment_link: offer.stripe_payment_link || '',
    showBuyButton: Boolean(offer.stripe_payment_link && String(offer.stripe_payment_link).trim()),
  };
}

function validateDemoLead(body) {
  const contact_name = body?.contact_name != null ? String(body.contact_name).trim() : '';
  const email = body?.email != null ? String(body.email).trim() : '';
  const phone = body?.phone != null ? String(body.phone).trim() : '';
  const company_name = body?.company_name != null ? String(body.company_name).trim() : '';
  const message = body?.message != null ? String(body.message).trim() : '';

  if (!contact_name) return { ok: false, error: 'missing_fields', fields: ['contact_name'] };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'invalid_email' };
  }
  return {
    ok: true,
    row: {
      contact_name,
      email,
      phone: phone || null,
      company_name: company_name || null,
      message: message || null,
      source: 'makeready-bot-offer',
    },
  };
}

function getOfferPageProps() {
  const { loadConfig, publicConfig } = require('./index');
  return {
    pricing: offerPricingLabels(),
    demo: publicConfig(loadConfig(DEMO_SLUG)),
  };
}

module.exports = {
  DEMO_SLUG,
  loadPlatformOffer,
  offerPricingLabels,
  validateDemoLead,
  formatUsdFromCents,
  getOfferPageProps,
};