#!/usr/bin/env node
/**
 * ops-seed-human-actions.js — seed the durable ops human-action set once.
 *
 * Standing, machine-checked boundaries (runtime:drift, cost:daily-guard,
 * phone:phantom-killer, phone:thin-client) are detector RULES and need no
 * seeding — the sync sweep raises them when their precondition is real.
 * This script seeds the one-off, human-boundary actions from the ops
 * backlog so they sit in data/human-actions.json waiting for Jordan:
 *
 *   runtime:reboot-verify              — reboot Frank once to prove resurrect
 *   network:dhcp-reservation           — DHCP reservation for Frank (MAC+IP
 *                                        gathered at RUN time — machine
 *                                        identity never enters the repo)
 *   ci:self-hosted-runner-offline      — remove the offline self-hosted runner
 *   deploy:vercel-cancel               — cancel Vercel after Cloudflare verified
 *   credential:*-rotation   (×5)       — rotate the secrets published to git
 *                                        history (HISTORICAL_SECRET_REMEDIATION)
 *   phone:usb-debugging                — attach the phone (R3)
 *   phone:run-thin-client-setup        — run the pushed script in Termux (R3)
 *
 * Idempotent: svc.request dedupes on blockerKey; re-runs are no-ops.
 * Secrets never appear in action records — rotation instructions name
 * dashboards and env var NAMES only.
 */
'use strict';

const { execFileSync } = require('child_process');
const { HumanActionService } = require('../lib/human-actions/service');

function lanIdentity() {
  // Windows-first (Frank), graceful fallback. Returns {ip, mac} or nulls.
  const out = { ip: null, mac: null };
  try {
    const conf = execFileSync('ipconfig', ['/all'], { encoding: 'utf8', timeout: 10000 });
    const blocks = conf.split(/\r?\n\r?\n/);
    for (const b of blocks) {
      const ip = (b.match(/IPv4 Address[^:]*:\s*([\d.]+)/) || [])[1];
      const mac = (b.match(/Physical Address[^:]*:\s*([0-9A-Fa-f-]+)/) || [])[1];
      if (ip && mac && !/Loopback|Tailscale|vEthernet|WSL|Hyper-V/i.test(b)) {
        out.ip = out.ip || ip;
        out.mac = out.mac || mac;
      }
    }
  } catch { /* non-Windows or ipconfig missing */ }
  return out;
}

function buildSpecs(net) {
  const ip = net.ip || '<current IP — run ipconfig>';
  const mac = net.mac || '<MAC — run getmac /v>';
  return [
    {
      blockerKey: 'runtime:reboot-verify',
      type: 'ops',
      boundary: { category: 'PHYSICAL_ACTION', capability: 'host.reboot' },
      title: 'Reboot Frank once to confirm PM2 resurrect restores the stack',
      description: 'PM2 was saved and a logon task registered to run `pm2 resurrect`. Nothing proves it works until the machine actually reboots once.',
      priority: 'normal',
      instructions: [
        'Reboot Frank at a convenient time',
        'After logon, run `pm2 ls` — every ecosystem app should come back online within a minute',
        'Run `npm run runtime:audit` — expect overall OK',
      ],
      // pm2-resurrect-observed requires an actual reboot since arming —
      // runtime-audit-clean alone resolved this action falsely (a green
      // audit needs no reboot). armedAt = seed time.
      verifier: { name: 'pm2-resurrect-observed', spec: { armedAt: new Date().toISOString() } },
      expectedOutcome: 'After reboot+logon, runtime audit reports OK without manual pm2 starts',
      sourceMissionId: 'ops-runtime-persistence',
    },
    {
      blockerKey: 'network:dhcp-reservation',
      type: 'ops',
      boundary: { category: 'EXTERNAL_SERVICE', externalSystem: 'router', capability: 'network.dhcp.reservation' },
      title: 'Reserve a DHCP lease for Frank in the router',
      description: `Frank's LAN address floats (currently ${ip}). The phone already resolves Frank via FRANK_HOSTS and Tailscale MagicDNS, so this is a backup against IP drift, not a blocker.`,
      priority: 'low',
      instructions: [
        `Frank's NIC MAC: ${mac}  —  current IPv4: ${ip}`,
        'Router admin UI → DHCP/LAN settings → Address reservation (names vary: "DHCP Reservation", "Static Lease", "Address Assignment")',
        `Add a reservation mapping ${mac} → ${ip} (or a stable address outside the dynamic pool)`,
        'Renew the lease or reboot to pick it up; confirm `ipconfig` shows the reserved address',
      ],
      verifier: { name: 'manual', spec: {} },
      expectedOutcome: `Frank holds ${ip} (or the chosen reserved address) across DHCP renewals`,
    },
    {
      blockerKey: 'ci:self-hosted-runner-offline',
      type: 'ops',
      boundary: { category: 'DEPLOYMENT', externalSystem: 'github', capability: 'ci.runner.manage' },
      title: 'Remove or revive the offline self-hosted Actions runner',
      description: 'C:\\Users\\Owner\\actions-runner exists but no runner service is installed, and no workflow in .github/workflows uses runs-on: self-hosted. An offline registered runner causes stuck queued runs (issue #195 was exactly this).',
      priority: 'low',
      instructions: [
        'Check GitHub → repo/org Settings → Actions → Runners: if an offline runner is registered, remove the registration there',
        'Then delete C:\\Users\\Owner\\actions-runner locally',
        'Alternative: if local CI is wanted, reinstall the service (config.cmd → svc install) — but nothing currently consumes it',
      ],
      verifier: { name: 'manual', spec: {} },
      expectedOutcome: 'No offline runner registered and the folder gone — or a deliberately reinstalled, online service',
    },
    {
      blockerKey: 'deploy:vercel-cancel',
      type: 'ops',
      boundary: { category: 'EXTERNAL_SERVICE', externalSystem: 'vercel', capability: 'billing.subscription.cancel' },
      title: 'Cancel Vercel — only after the Cloudflare deploy is verified live',
      description: 'docs/VERCEL_EXIT_PLAN.md (PR #413) is the runbook. Cancelling before the replacement serves real traffic is an outage, not a savings.',
      priority: 'high',
      instructions: [
        'Precondition: the Cloudflare Worker serves production traffic (see VERCEL_EXIT_PLAN.md steps 1-5: env vars recreated as secrets, Worker deployed, DNS cutover done, smoke tests pass)',
        'Verify nothing still points at Vercel: this action\'s machine check greps the repo for *.vercel.app',
        'By hand: Stripe Dashboard → Developers → Webhooks — no enabled endpoint still targets a *.vercel.app URL',
        'By hand: DNS — the customer domain no longer CNAMEs/A-records to Vercel',
        'Then: Vercel Dashboard → Project Settings → General → Delete/Cancel (or downgrade the subscription)',
      ],
      verifier: { name: 'app-tests-pass', spec: { dir: process.cwd(), command: 'node scripts/vercel-exit-check.js', timeoutMs: 60000 } },
      expectedOutcome: 'No *.vercel.app reference in the tracked tree, no Stripe endpoint on Vercel, DNS off Vercel — then cancelled',
      sourceMissionId: 'ops-vercel-exit',
    },
    // ── Credential rotations (git-history published — public repo) ──────
    {
      blockerKey: 'credential:stripe-restricted-key-rotation',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'stripe', capability: 'credential.rotate' },
      title: 'Rotate the Stripe restricted LIVE key leaked in git history',
      description: 'docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md: an rk_live_ key is recoverable from public git history. Rotation status unknown — treat as compromised.',
      priority: 'high',
      instructions: [
        'Stripe Dashboard (live) → Developers → API keys → roll/revoke the leaked rk_live_ key and create a new RESTRICTED key (Checkout Sessions write only)',
        'Install the new value in: .env / .env.local on Frank (STRIPE_SECRET_KEY), Supabase Edge Function secrets if used there, any hosting env (Vercel project env vars until cutover)',
        'Never paste the value into chat or commit it',
        'Heidi verifies afterwards with `node test-critical-path.js` — Stripe config still works under the rotated key',
      ],
      verifier: { name: 'app-tests-pass', spec: { dir: process.cwd(), command: 'node test-critical-path.js', timeoutMs: 120000 } },
      expectedOutcome: 'Leaked key revoked; critical-path checks pass under the new key',
    },
    {
      blockerKey: 'credential:stripe-webhook-secret-rotation',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'stripe', capability: 'credential.rotate' },
      title: 'Rotate the Stripe webhook signing secret leaked in git history',
      description: 'docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md: a whsec_ signing secret is recoverable from public git history — forged webhook events are possible until rotated.',
      priority: 'high',
      instructions: [
        'Stripe Dashboard → Developers → Webhooks → the live endpoint → Roll secret (or delete+recreate the endpoint)',
        'Install the new whsec_ in .env / .env.local on Frank (STRIPE_WEBHOOK_SECRET_01 and/or STRIPE_WEBHOOK_SECRET) and any hosting env',
        'Send a test event from the dashboard (or `stripe trigger checkout.session.completed`) and confirm a verified 200 from /api/webhooks/stripe',
        'Heidi verifies afterwards with `node test-critical-path.js`',
      ],
      verifier: { name: 'app-tests-pass', spec: { dir: process.cwd(), command: 'node test-critical-path.js', timeoutMs: 120000 } },
      expectedOutcome: 'Old whsec_ dead; signed webhook events verify end-to-end',
    },
    {
      blockerKey: 'credential:supabase-service-role-rotation',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'supabase', capability: 'credential.rotate' },
      title: 'Rotate the Supabase service-role JWT leaked in git history (21 files)',
      description: 'docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md: a service_role JWT is recoverable from 21 files in public git history. Service role bypasses RLS — this is the most dangerous leaked secret.',
      priority: 'high',
      instructions: [
        'Supabase Dashboard → Project Settings → API → rotate the JWT secret (this also re-issues anon/service_role keys), then regenerate the service_role key',
        'Install the new value in: .env / .env.local on Frank (SUPABASE_SERVICE_ROLE_KEY), Supabase Edge Function secrets, any hosting env (Vercel until cutover)',
        'Expect a brief invalid-token window for running services — restart heidi-web-standalone + workers after installing',
        'Heidi verifies afterwards with `node test-critical-path.js`',
      ],
      verifier: { name: 'app-tests-pass', spec: { dir: process.cwd(), command: 'node test-critical-path.js', timeoutMs: 120000 } },
      expectedOutcome: 'Old service-role JWT rejected; critical-path checks pass under the rotated key',
    },
    {
      blockerKey: 'credential:vercel-oidc-rotation',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'vercel', capability: 'credential.rotate' },
      title: 'Rotate the Vercel OIDC token leaked in git history',
      description: 'docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md: a Vercel OIDC token is recoverable from public git history — it could mint deployments/access under the project identity.',
      priority: 'high',
      instructions: [
        'Vercel Dashboard → Project → Settings → Functions/OIDC (or Account → Tokens) — revoke the leaked token/issuer and re-issue',
        'Install the new value wherever OIDC federation is configured (Supabase Edge Function secrets, CI variables)',
        'Note: if the Vercel exit completes first, this boundary may resolve by deletion — cancel only after confirming nothing authenticates with it',
      ],
      verifier: { name: 'manual', spec: {} },
      expectedOutcome: 'Leaked OIDC token revoked or the Vercel project it belongs to is gone',
    },
    {
      blockerKey: 'credential:keeper-breakglass-rotation',
      type: 'credential',
      boundary: { category: 'CREDENTIAL', externalSystem: 'keeper', capability: 'credential.rotate' },
      title: 'Rotate the Keeper break-glass JWT leaked in git history',
      description: 'docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md: a Keeper break-glass JWT is recoverable from public git history — it gates emergency access paths.',
      priority: 'high',
      instructions: [
        'Keeper dashboard → break-glass/backup access settings → rotate the JWT/credential',
        'Install the new value in .env / .env.local on Frank and Supabase Edge Function secrets (keeper-break-glass functions read it there)',
        'Confirm the keeper-break-glass edge function still answers after rotation',
      ],
      verifier: { name: 'manual', spec: {} },
      expectedOutcome: 'Old break-glass JWT rejected; emergency access still functions under the new one',
    },
    // ── Phone prerequisites (R3 — physical) ─────────────────────────────
    {
      blockerKey: 'phone:usb-debugging',
      type: 'ops',
      boundary: { category: 'PHYSICAL_ACTION', externalSystem: 'adb', capability: 'phone.physical.attach' },
      title: 'Plug the phone into Frank with USB debugging on',
      description: 'Phone-side work (phantom-killer fix, thin-client push) requires an adb session. No device is attached. Alternatively, on Android 14+ enable Developer Options → "Disable child process restrictions" to fix phantom killing without a cable.',
      priority: 'normal',
      instructions: [
        'Connect the phone to Frank by USB',
        'On the phone: Settings → Developer options → USB debugging → ON, and accept the computer\'s fingerprint',
        'Optional no-cable path (Android 14+): Developer options → "Disable child process restrictions"',
        'Tell Heidi "check again" — `adb devices` is re-checked automatically',
      ],
      verifier: { name: 'phone-adb-attached', spec: {} },
      expectedOutcome: '`adb devices` lists the phone as authorized (status device, not unauthorized)',
      sourceMissionId: 'ops-phone-stability',
    },
    {
      blockerKey: 'phone:run-thin-client-setup',
      type: 'ops',
      boundary: { category: 'PHYSICAL_ACTION', externalSystem: 'termux', capability: 'phone.termux.execute' },
      title: 'Run setup-thin-client.sh on the phone (Termux cannot be driven over adb)',
      description: 'termux/setup-thin-client.sh is pushed to /sdcard/Download/ when the phone is attached. Termux is an app sandbox — adb can push but not execute without root.',
      priority: 'normal',
      instructions: [
        'On the phone, open Termux and run: bash /sdcard/Download/setup-thin-client.sh --dry-run',
        'Review the plan, then run for real: bash /sdcard/Download/setup-thin-client.sh --disable-local-llm',
        'Verification is automatic: Heidi checks the phone no longer listens on :8080 and Frank\'s Ollama log shows requests from the phone\'s tailnet IP',
        'For the machine check to see the phone, set PHONE_TAILNET_HOST=felicias-microwave.tailc50af2.ts.net (or the phone\'s current tailnet name) in .env.local',
      ],
      verifier: { name: 'phone-thin-client', spec: {} },
      expectedOutcome: 'Phone serves nothing on :8080 and reaches Frank\'s Ollama over the tailnet',
      sourceMissionId: 'ops-phone-stability',
    },
  ];
}

function main() {
  const svc = new HumanActionService();
  const net = lanIdentity();
  const specs = buildSpecs(net);
  const out = { created: [], alreadyOpen: [], resolvedOrTerminal: [] };
  for (const spec of specs) {
    try {
      const { action, created } = svc.request(spec);
      (created ? out.created : out.alreadyOpen).push(`${spec.blockerKey} (${action.id})`);
    } catch (e) {
      console.error(`seed failed for ${spec.blockerKey}: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    }
  }
  console.log(`network identity used: ip=${net.ip || 'unread'} mac=${net.mac || 'unread'}`);
  console.log(`created:    ${out.created.length}`);
  out.created.forEach((k) => console.log(`  + ${k}`));
  console.log(`already open: ${out.alreadyOpen.length}`);
  out.alreadyOpen.forEach((k) => console.log(`  = ${k}`));
}

if (require.main === module) main();
module.exports = { buildSpecs };
