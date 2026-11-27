#!/usr/bin/env node
'use strict';

/**
 * Re-run lead scoring v2 against configured fixtures (or optional DB rows later).
 * --dry-run prints scores without upsert.
 */

const path = require('path');
const { loadConfig, collectFromSources } = require('../../heidi-core/jobs/lead-sweep');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = process.cwd();
  const config = loadConfig(repoRoot);
  const leads = await collectFromSources(config, repoRoot, {
    fetch: global.fetch,
    model: process.env.HEIDI_MODEL_FLOOR || process.env.LOCAL_MODEL_NAME,
  });

  const summary = {
    dry_run: dryRun,
    total: leads.length,
    scored: leads.filter((l) => l.score != null).length,
    unscored: leads.filter((l) => l.score == null).length,
    by_source: {},
  };

  for (const l of leads) {
    summary.by_source[l.source] = (summary.by_source[l.source] || 0) + 1;
  }

  if (dryRun) {
    console.log(JSON.stringify({ summary, leads }, null, 2));
    return;
  }

  const { runLeadSweep } = require('../../heidi-core/jobs/lead-sweep');
  let store = null;
  try {
    store = require('../../lib/store').getStore();
  } catch {
    store = null;
  }
  const r = await runLeadSweep({ store, repoRoot, fetch: global.fetch });
  console.log(JSON.stringify({ summary, digest: r.mdPath }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});