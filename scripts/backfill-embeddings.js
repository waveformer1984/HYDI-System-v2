#!/usr/bin/env node
'use strict';

/**
 * backfill-embeddings.js — (re)embed hydi_facts rows via local Ollama ($0).
 *
 * hydi_facts.embedding is vector(768) for nomic-embed-text. Rows whose
 * embedding is NULL or whose stored vector length != HYDI_EMBEDDING_DIM are
 * (re)embedded. Run AFTER the 768 migration has been applied.
 *
 * Usage:
 *   node scripts/backfill-embeddings.js --dry-run   # count + plan, no writes
 *   node scripts/backfill-embeddings.js --apply     # embed + PATCH rows
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      OLLAMA_HOST or OLLAMA_URL (default http://127.0.0.1:11434),
 *      OLLAMA_EMBEDDING_MODEL (default nomic-embed-text),
 *      HYDI_EMBEDDING_DIM (default 768 — must match the column dimension).
 */
const path = require('path');
const fs = require('fs');

for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (fs.existsSync(p)) {
    try { require('dotenv').config({ path: p }); } catch (_) { /* optional */ }
  }
}

const TARGET_DIM = parseInt(process.env.HYDI_EMBEDDING_DIM || '768', 10);
const SCHEMA_DIM = 768; // hydi_facts.embedding column after 20261117000000 migration
const MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const OLLAMA = (process.env.OLLAMA_HOST || process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const PAGE = 500;
const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');

function embeddingDim(raw) {
  if (raw == null) return 0;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.length : 0;
  } catch (_) {
    return 0;
  }
}

async function supabaseGet(table, query) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${table} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchAllFacts() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await supabaseGet(
      'hydi_facts',
      `select=id,content,embedding&order=created_at.asc&limit=${PAGE}&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`ollama embed -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const vec = data.embedding;
  if (!Array.isArray(vec) || vec.length !== TARGET_DIM) {
    throw new Error(`ollama returned dim=${Array.isArray(vec) ? vec.length : 'n/a'}, expected ${TARGET_DIM} (model=${MODEL})`);
  }
  return vec;
}

async function patchEmbedding(id, vec) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/hydi_facts?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ embedding: `[${vec.join(',')}]` }),
  });
  if (!res.ok) throw new Error(`PATCH hydi_facts ${id} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  if (TARGET_DIM !== SCHEMA_DIM) {
    console.error(
      `backfill-embeddings: HYDI_EMBEDDING_DIM=${TARGET_DIM} but schema expects ${SCHEMA_DIM}.`,
    );
    console.error('Apply the vector(768) migration first (supabase/migrations/20261117000000_hydi_facts_embedding_768.sql).');
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('backfill-embeddings: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(2);
  }

  const facts = await fetchAllFacts();
  const stale = facts.filter((f) => embeddingDim(f.embedding) !== TARGET_DIM);
  console.log(`hydi_facts: ${facts.length} rows, ${stale.length} need (re)embedding to dim=${TARGET_DIM} via ${MODEL} @ ${OLLAMA}`);

  if (dryRun) {
    for (const f of stale.slice(0, 10)) {
      console.log(`  would embed id=${f.id} content=${JSON.stringify(String(f.content).slice(0, 60))} currentDim=${embeddingDim(f.embedding)}`);
    }
    if (stale.length > 10) console.log(`  ... and ${stale.length - 10} more`);
    console.log('dry-run: pass --apply to write embeddings');
    return;
  }

  let ok = 0;
  const failures = [];
  for (const f of stale) {
    try {
      const vec = await embed(f.content);
      await patchEmbedding(f.id, vec);
      ok += 1;
      if (ok % 10 === 0) console.log(`  progress: ${ok}/${stale.length}`);
    } catch (e) {
      failures.push({ id: f.id, error: e.message });
      console.error(`  FAIL id=${f.id}: ${e.message}`);
    }
  }
  console.log(`done: ${ok} embedded, ${failures.length} failed`);
  if (failures.length) {
    console.error(JSON.stringify(failures.slice(0, 20)));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
