#!/usr/bin/env node
'use strict';
/**
 * Heidi job scout — CLI entry used by hydi-schedulers (`--once`).
 *
 *   node scripts/job-scout.js --once
 *
 * Reads the public boards configured in config/job-scout.json, ranks leads
 * against the division profiles and writes .runtime/job-scout/. Read-only
 * toward every job site: it never logs in, bids, applies or messages.
 * Exit 1 only when every enabled source failed.
 */

const { runScout } = require('../lib/job-scout/scout');
const { createNotification } = require('../lib/notifications/notify');

function createSupabase() {
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key);
}

// Strong-lead alerts ride lib/notifications/notify.js → notifications table
// (+ best-effort web push). No Supabase key → no notifications, scan still runs.
function buildNotifyFn() {
  const supabase = createSupabase();
  if (!supabase) return null;
  return (input) => createNotification(supabase, input);
}

async function main() {
  const summary = await runScout({ notifyFn: buildNotifyFn() });
  const parts = Object.entries(summary.sources).map(([k, v]) => `${k}=${v.ok ? v.count : `ERR(${v.error})`}`);
  console.log(`[job-scout] fetched=${summary.fetched} kept=${summary.kept} new=${summary.newLeads} strong=${summary.newStrong} ${parts.join(' ')}`);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`[job-scout] failed: ${(e && e.message) || e}`);
  process.exit(1);
});
