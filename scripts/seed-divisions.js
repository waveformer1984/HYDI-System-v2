#!/usr/bin/env node
'use strict';

/**
 * seed-divisions.js — idempotently seed the 10 HYDI divisions (Phase 5).
 *
 * Usage:
 *   node scripts/seed-divisions.js            # apply (local Supabase only)
 *   node scripts/seed-divisions.js --dry-run  # print plan only
 *   node scripts/seed-divisions.js --allow-remote  # permit non-local SUPABASE_URL
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).
 * Loads .env.local then .env like heidi-core does. Never prints secrets.
 *
 * Idempotent: upserts on `slug`; existing rows keep their status/notes
 * unless --force is passed (then only `name` is refreshed — Jordan's
 * edits to status/notes are never clobbered by default).
 */
const path = require('path');
const fs = require('fs');

for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (fs.existsSync(p)) {
    try { require('dotenv').config({ path: p }); } catch (_) { /* optional */ }
  }
}

const DIVISIONS = [
  { slug: 'appforge', name: 'AppForge', notes: 'TODO(owner): describe AppForge — seeded placeholder.' },
  { slug: 'groundwork', name: 'GroundWork', notes: 'TODO(owner): describe GroundWork — seeded placeholder.' },
  { slug: 'j-stein-collection', name: 'J.STEIN Collection', notes: 'TODO(owner): describe J.STEIN Collection — seeded placeholder.' },
  { slug: 'colters-little-smokehouse', name: "Colter's Little Smokehouse", notes: "TODO(owner): describe Colter's Little Smokehouse — seeded placeholder." },
  { slug: 'rezonate', name: 'Rezonate / Waveformer Records', notes: 'TODO(owner): describe Rezonate — seeded placeholder.' },
  { slug: 'build-a-mind', name: 'Build-A-Mind', notes: 'TODO(owner): describe Build-A-Mind — seeded placeholder.' },
  { slug: 'z-aero-foundation', name: 'Z-Aero Foundation', notes: 'TODO(owner): describe Z-Aero Foundation — seeded placeholder.' },
  { slug: 'forgefinder', name: 'ForgeFinder', notes: 'TODO(owner): describe ForgeFinder — seeded placeholder.' },
  { slug: 'galactic-bytes', name: 'Galactic Bytes', notes: 'TODO(owner): describe Galactic Bytes — seeded placeholder.' },
  { slug: 'protoforge-manufacturing', name: 'ProtoForge Manufacturing', notes: 'TODO(owner): describe ProtoForge Manufacturing — seeded placeholder.' },
];

function isLocalSupabaseUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === 'host.docker.internal';
  } catch {
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const allowRemote = process.argv.includes('--allow-remote');
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('seed-divisions: SUPABASE_URL and a service/anon key are required');
    process.exit(2);
  }

  let targetHost;
  try { targetHost = new URL(url).host; } catch { targetHost = url; }
  console.log(`seed-divisions: target host ${targetHost}`);

  if (!allowRemote && !isLocalSupabaseUrl(url)) {
    console.error('seed-divisions: refusing non-local Supabase URL (pass --allow-remote to override)');
    process.exit(2);
  }

  if (dryRun) {
    for (const d of DIVISIONS) console.log(`would upsert divisions.slug=${d.slug} (${d.name})`);
    console.log(`dry-run: ${DIVISIONS.length} divisions`);
    return;
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  // Two-step idempotent seed: insert only missing slugs, then refresh
  // `name` on existing rows — Jordan's status/notes edits are preserved.
  const existingRes = await fetch(`${url}/rest/v1/divisions?select=slug,name`, { headers });
  if (!existingRes.ok) {
    console.error(`seed-divisions: read failed HTTP ${existingRes.status}: ${(await existingRes.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const existing = new Map((await existingRes.json()).map((r) => [r.slug, r.name]));

  const missing = DIVISIONS.filter((d) => !existing.has(d.slug));
  const renames = DIVISIONS.filter((d) => existing.has(d.slug) && existing.get(d.slug) !== d.name);

  if (missing.length) {
    const res = await fetch(`${url}/rest/v1/divisions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(missing.map((d) => ({ slug: d.slug, name: d.name, status: 'seeded', notes: d.notes }))),
    });
    if (!res.ok) {
      console.error(`seed-divisions: insert failed HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      process.exit(1);
    }
  }
  for (const d of renames) {
    const res = await fetch(`${url}/rest/v1/divisions?slug=eq.${encodeURIComponent(d.slug)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: d.name }),
    });
    if (!res.ok) console.warn(`seed-divisions: rename ${d.slug} failed HTTP ${res.status}`);
  }

  console.log(`seed-divisions: inserted ${missing.length}, renamed ${renames.length}, kept ${DIVISIONS.length - missing.length - renames.length} unchanged`);

  const check = await fetch(`${url}/rest/v1/divisions?select=slug,name,status`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await check.json();
  console.log(`seed-divisions: divisions table now has ${Array.isArray(rows) ? rows.length : '?'} rows`);
  for (const r of (Array.isArray(rows) ? rows : [])) console.log(`  - ${r.slug}: ${r.name} [${r.status}]`);
}

main().catch((e) => { console.error('seed-divisions failed:', e.message); process.exit(1); });
