#!/usr/bin/env node
/**
 * Wait for Supabase to be ready before starting Next.js
 *
 * Problem: PGRST002 "Could not query database for schema cache"
 * Cause: PostgREST hasn't cached the schema yet when Next.js starts
 * Solution: Retry with exponential backoff until Supabase is ready
 *
 * Usage:
 *   node scripts/wait-for-supabase.js
 *   (called from npm dev before next dev)
 */

const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MAX_RETRIES = 30; // ~60 seconds with exponential backoff
const INITIAL_DELAY = 1000; // 1s

async function waitForSupabase() {
  console.log('[wait-for-supabase] Starting health checks...');
  console.log(`[wait-for-supabase] Supabase URL: ${SUPABASE_URL}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[wait-for-supabase] Missing Supabase credentials, skipping');
    return true;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Try a simple schema query
      const { data, error } = await client
        .from('memories')
        .select('*', { count: 'exact' })
        .limit(1);

      if (error) {
        if (error.message.includes('PGRST002')) {
          console.log(`[wait-for-supabase] Attempt ${attempt + 1}/${MAX_RETRIES}: Schema cache not ready`);
        } else {
          console.warn(`[wait-for-supabase] Query error: ${error.message}`);
        }
      } else {
        console.log('[wait-for-supabase] ✅ Supabase is ready!');
        return true;
      }
    } catch (e) {
      console.log(`[wait-for-supabase] Attempt ${attempt + 1}/${MAX_RETRIES}: ${e.message}`);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(INITIAL_DELAY * Math.pow(2, attempt), 16000);
    console.log(`[wait-for-supabase] Waiting ${delay}ms before retry...`);
    await new Promise((r) => setTimeout(r, delay));
  }

  console.error('[wait-for-supabase] ❌ Supabase did not become ready after 60s');
  process.exit(1);
}

async function main() {
  try {
    await waitForSupabase();
    console.log('[wait-for-supabase] Launching Next.js...');
    console.log('[wait-for-supabase] SUPERVISOR: Next.js is ready to start\n');
  } catch (e) {
    console.error('[wait-for-supabase] Fatal:', e.message);
    process.exit(1);
  }
}

main();
