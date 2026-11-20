#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_DIR = path.join(process.cwd(), 'config', 'makeready');
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('MakeReady onboard — rates must come from the owner (not invented here).\n');
    const slug = (await ask(rl, 'Company slug (e.g. jenny-makeready): ')).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      console.error('Invalid slug.');
      process.exit(1);
    }
    const displayName = (await ask(rl, 'Display name: ')).trim();
    const ownerEmail = (await ask(rl, 'Owner email: ')).trim();
    const serviceArea = (await ask(rl, 'Service area (e.g. Austin metro): ')).trim();
    const pricePath = (await ask(rl, 'Path to price_points JSON file: ')).trim();
    if (!fs.existsSync(pricePath)) {
      console.error('Price file not found.');
      process.exit(1);
    }
    const pricePoints = JSON.parse(fs.readFileSync(pricePath, 'utf8'));
    if (!pricePoints.phases) {
      console.error('price_points.phases required.');
      process.exit(1);
    }
    const config = {
      slug,
      display_name: displayName,
      demo: false,
      owner_email: ownerEmail,
      service_area: serviceArea,
      lead_time: 'Owner confirms on site',
      insurance_statement: 'Update after legal review.',
      services: [],
      policies: ['Access codes confirmed by phone only.'],
      stripe_payment_link: '',
      price_points: pricePoints,
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const out = path.join(CONFIG_DIR, `${slug}.json`);
    fs.writeFileSync(out, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log('Wrote', out);
    console.log('Set MAKEREADY_CREW_COMPANY_SLUG=' + slug);
    console.log('Set MAKEREADY_CREW_PIN and MAKEREADY_CREW_SESSION_SECRET on Frank.');
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
