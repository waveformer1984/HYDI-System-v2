#!/usr/bin/env node
'use strict';

/**
 * backfill-embeddings.js — re-embed hydi_facts rows via local Ollama ($0).
 *
 * BLOCKED until Jordan picks embedding dimension strategy (see DISCREPANCIES.md).
 *
 * Usage:
 *   node scripts/backfill-embeddings.js --dry-run
 *   HYDI_EMBEDDING_DIM=1536 node scripts/backfill-embeddings.js --apply
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OLLAMA_HOST (default http://127.0.0.1:11434)
 */
const path = require('path');
const fs = require('fs');

for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (fs.existsSync(p)) {
    try { require('dotenv').config({ path: p }); } catch (_) { /* optional */ }
  }
}

const TARGET_DIM = parseInt(process.env.HYDI_EMBEDDING_DIM || '1536', 10);
const SCHEMA_DIM = 1536; // hydi_facts.embedding column today
const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

async function main() {
  if (TARGET_DIM !== SCHEMA_DIM) {
    console.error(
      `backfill-embeddings: HYDI_EMBEDDING_DIM=${TARGET_DIM} but schema expects ${SCHEMA_DIM}.`,
    );
    console.error('See docs/DISCREPANCIES.md — Jordan must choose 1536 model or schema migration.');
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('backfill-embeddings: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(2);
  }
  if (dryRun) {
    console.log('dry-run: would fetch hydi_facts without embedding / stale rows and call Ollama embed');
    console.log(`target_dim=${TARGET_DIM} ollama=${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}`);
    return;
  }
  console.error('backfill-embeddings: --apply not implemented until dimension decision — dry-run only');
  process.exit(3);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
