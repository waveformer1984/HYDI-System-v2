'use strict';

/**
 * Supabase provisioning module.
 *
 * verify(): is the project's REST API reachable with the configured env?
 * provision(): if the cloud project is paused, attempt a Management-API
 *   restore and poll until healthy. Returns 'blocked' (with the exact human
 *   action needed) when the platform refuses — e.g. HTTP 402 when the org's
 *   billing is suspended on the Vercel Marketplace side.
 *
 * Never prints tokens or keys. All results are secret-free strings.
 */

const { getSupabaseAccessToken, managementApi, sleep } = require('./util');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'akbnfovjdcobifeupvbn';
const RESTORE_POLL_MS = 15_000;
const RESTORE_POLL_ATTEMPTS = 40; // ~10 minutes

async function verify() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { status: 'failed', detail: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in environment' };
  }
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      return { status: 'verified', detail: `PostgREST reachable at ${url} (HTTP ${res.status})` };
    }
    return { status: 'failed', detail: `PostgREST at ${url} returned HTTP ${res.status}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown error';
    return { status: 'failed', detail: `PostgREST at ${url} unreachable (${msg})` };
  }
}

async function provision() {
  // Local data plane needs no cloud provisioning.
  if ((process.env.SUPABASE_URL || '').includes('127.0.0.1') || (process.env.SUPABASE_URL || '').includes('localhost')) {
    return {
      status: 'blocked',
      detail: 'SUPABASE_URL points at the local stack; start it with start-heidi-everything.ps1 (Step 1.5).',
      actionRequired: 'Run start-heidi-everything.ps1 (requires Docker Desktop) if the local stack is down.',
    };
  }

  const token = getSupabaseAccessToken();
  if (!token) {
    return {
      status: 'blocked',
      detail: 'No Supabase Management API token available (SUPABASE_ACCESS_TOKEN unset, CLI keyring entry missing).',
      actionRequired: 'Run `supabase login` on this machine or set SUPABASE_ACCESS_TOKEN.',
    };
  }

  const proj = await managementApi(token, 'GET', `/projects/${PROJECT_REF}`);
  if (proj.status === 404) {
    return { status: 'blocked', detail: `Project ${PROJECT_REF} not found for this account.`, actionRequired: 'Confirm the project ref / account.' };
  }
  const state = proj.json && proj.json.status;

  if (state === 'ACTIVE_HEALTHY') {
    return { status: 'verified', detail: `Cloud project ${PROJECT_REF} is ACTIVE_HEALTHY.` };
  }

  if (state === 'INACTIVE') {
    const restore = await managementApi(token, 'POST', `/projects/${PROJECT_REF}/restore`);
    if (restore.status === 402) {
      return {
        status: 'blocked',
        detail: `Restore refused with HTTP 402 (billing). Org is Vercel-Marketplace-managed; the Supabase resource is Suspended on the Vercel side.`,
        actionRequired:
          'In the Vercel dashboard (team forgefinder) -> Integrations -> Supabase resource, resolve the suspension/billing, then re-run this bootstrap.',
      };
    }
    if (!restore.ok && restore.status !== 201 && restore.status !== 200 && restore.status !== 204) {
      return { status: 'failed', detail: `Restore request returned HTTP ${restore.status}.` };
    }
    for (let i = 0; i < RESTORE_POLL_ATTEMPTS; i++) {
      await sleep(RESTORE_POLL_MS);
      const poll = await managementApi(token, 'GET', `/projects/${PROJECT_REF}`);
      const s = poll.json && poll.json.status;
      if (s === 'ACTIVE_HEALTHY') {
        return { status: 'verified', detail: `Project ${PROJECT_REF} restored to ACTIVE_HEALTHY.` };
      }
      if (s && s.startsWith('RESTORE_FAIL')) {
        return { status: 'failed', detail: `Restore failed (project status ${s}).` };
      }
    }
    return { status: 'failed', detail: 'Restore did not reach ACTIVE_HEALTHY within the polling window.' };
  }

  return { status: 'failed', detail: `Project ${PROJECT_REF} in unexpected state: ${state}.` };
}

module.exports = { name: 'supabase', verify, provision };
