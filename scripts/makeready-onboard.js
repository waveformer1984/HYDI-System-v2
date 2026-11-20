#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');
const {
  buildConfigFromAnswers,
  writeCustomerConfig,
  embedScriptSnippet,
  configPath,
} = require('../lib/makeready-bot/onboard');
const { SLUG_RE } = require('../lib/makeready-bot');

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

async function askMultiline(rl, header) {
  process.stderr.write(`${header}\n(empty line to finish)\n`);
  const lines = [];
  for (;;) {
    const line = await ask(rl, '> ');
    if (!line.trim()) break;
    lines.push(line);
  }
  return lines;
}

async function runInteractive(argv) {
  const args = argv.slice(2);
  const force = args.includes('--force');
  const slug = args.find((a) => !a.startsWith('-'));
  if (!slug || !SLUG_RE.test(slug)) {
    process.stderr.write('Usage: node scripts/makeready-onboard.js <slug> [--force]\n');
    process.exit(1);
  }
  if (fsExists(slug) && !force) {
    process.stderr.write(`Refusing to overwrite existing config: ${configPath(slug)}\n`);
    process.stderr.write('Re-run with --force to replace.\n');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  try {
    const display_name = await ask(rl, 'Company display name: ');
    const service_area = await ask(rl, 'Service-area ZIPs (as you want them shown): ');
    const owner_email = await ask(rl, 'Owner email (job notifications): ');
    const lead_time = await ask(rl, 'Lead time statement: ');
    const insurance_statement = await ask(rl, 'Insurance / bonding statement: ');
    const minimum_charge = await ask(rl, 'Minimum charge (USD, e.g. 425): ');
    const story_multiplier_1 = await ask(rl, 'Story multiplier — 1 story (default 1): ') || '1';
    const story_multiplier_2 = await ask(rl, 'Story multiplier — 2 story (default 1.12): ') || '1.12';
    const story_multiplier_3 = await ask(rl, 'Story multiplier — 3 story (default 1.22): ') || '1.22';
    const stripe_payment_link = await ask(rl, 'Stripe Payment Link URL (optional, Enter to skip): ');

    const phase_lines = await askMultiline(
      rl,
      'Phases — one per line: <phase_id> <per_sqft_rate>  (e.g. final_clean 0.32)',
    );
    const addon_lines = await askMultiline(
      rl,
      'Add-ons — optional, one per line: <id>|<label> <price>  or  id Label words 85',
    );

    const built = buildConfigFromAnswers(slug, {
      display_name,
      service_area,
      owner_email,
      lead_time,
      insurance_statement,
      minimum_charge,
      story_multiplier_1,
      story_multiplier_2,
      story_multiplier_3,
      stripe_payment_link,
      phase_lines,
      addon_lines,
      demo: false,
    });
    if (!built.ok) {
      process.stderr.write(`Validation failed: ${JSON.stringify(built)}\n`);
      process.exit(1);
    }

    const written = writeCustomerConfig(slug, built.config, { force });
    if (!written.ok) {
      process.stderr.write(`${written.error}: ${written.path || ''}\n`);
      process.exit(1);
    }

    process.stdout.write(`\nWrote ${written.path}\n\nEmbed snippet:\n\n`);
    process.stdout.write(`${embedScriptSnippet(slug)}\n`);
  } finally {
    rl.close();
  }
}

function fsExists(slug) {
  return fs.existsSync(configPath(slug));
}

if (require.main === module) {
  runInteractive(process.argv).catch((e) => {
    process.stderr.write(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}