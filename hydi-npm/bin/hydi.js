#!/usr/bin/env node
/**
 * hydi CLI — ProtoForge Industries
 * Usage: hydi <command> [options]
 */

'use strict';

const { program } = require('commander');
const { HydiClient } = require('../src/index.js');
require('dotenv').config();

const VERSION = '1.0.0';

/* ── helpers ── */
function getClient() {
  return new HydiClient();
}

function statusIcon(s) {
  return s === 'OK' ? '✅' : s === 'WARNING' ? '🟡' : s === 'CRITICAL' ? '🔴' : '❓';
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/* ── CLI ── */
program
  .name('hydi')
  .description('HYDI health monitoring CLI — ProtoForge Industries')
  .version(VERSION);

/* ── check ── */
program
  .command('check')
  .description('Run a full health check against your Supabase project')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.check();

      if (opts.json) { printJson(result); process.exit(result.overall_status === 'CRITICAL' ? 1 : 0); }

      console.log('\n🔍 HYDI HEALTH CHECK\n' + '═'.repeat(56));
      Object.entries(result.components).forEach(([key, val]) => {
        console.log(`  ${statusIcon(val.status)} ${key.padEnd(14)} ${val.status}`);
      });
      console.log('═'.repeat(56));
      console.log(`\n${statusIcon(result.overall_status)} OVERALL: ${result.overall_status}\n`);

      if (result.warnings.length) {
        result.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
      }
      if (result.issues.length) {
        result.issues.forEach(i => console.log(`  🔴 ${i}`));
      }
      console.log('');

      process.exit(result.overall_status === 'CRITICAL' ? 1 : 0);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(2);
    }
  });

/* ── trends ── */
program
  .command('trends')
  .description('Show trend analysis across last 20 health runs')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data   = await client.analyzeTrends();
      if (opts.json) { printJson(data); return; }

      const icon = { stable: '📈', degrading: '📉', critical_trend: '🚨' };
      console.log(`\n${icon[data.status] || '❓'} TREND: ${(data.status || '').toUpperCase()}`);
      console.log(`   ${data.reason}`);
      if (data.metrics) {
        console.log(`\n   Critical runs: ${data.metrics.critical_pct}%`);
        console.log(`   Warning runs:  ${data.metrics.warning_pct}%`);
        console.log(`   Avg queue:     ${data.metrics.avg_queue_size} jobs`);
        console.log(`   Fail rate:     ${data.metrics.failure_rate_pct}%`);
      }
      console.log('');
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(2);
    }
  });

/* ── heal ── */
program
  .command('heal')
  .description('Trigger auto_heal_from_trends() immediately')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data   = await client.autoHeal();
      if (opts.json) { printJson(data); return; }

      if (data.healed === 0) {
        console.log('\n✅ Nothing to heal — system nominal.\n');
      } else {
        console.log(`\n🔧 Healed ${data.healed} issue(s):`);
        (data.actions || []).forEach(a => {
          console.log(`   → ${a.action} (${a.reason})`);
        });
        console.log('');
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(2);
    }
  });

/* ── dashboard ── */
program
  .command('dashboard')
  .description('Print full system dashboard snapshot')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const data   = await client.dashboard();
      if (opts.json) { printJson(data); return; }

      console.log('\n📊 HYDI SYSTEM DASHBOARD\n' + '═'.repeat(56));
      console.log(`  Status:         ${statusIcon(data.current_status)} ${data.current_status}`);
      console.log(`  Trend:          ${data.trend_status} — ${data.trend_reason}`);
      console.log(`  Escalation:     ${data.escalation_level} · ${data.escalation_action}`);
      console.log(`  Queue (queued): ${data.jobs_queued}`);
      console.log(`  Queue (failed): ${data.jobs_failed}`);
      console.log(`  Queue (dead):   ${data.jobs_dead}`);
      console.log(`  Events (1h):    ${data.events_last_hour}`);
      console.log(`  Auto-heals 24h: ${data.auto_heals_24h}`);
      console.log('═'.repeat(56));
      console.log(`  As of: ${data.dashboard_as_of}\n`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(2);
    }
  });

/* ── ursula ── */
program
  .command('ursula')
  .description('Get Ursula AI agent health summary')
  .option('--json', 'Output raw JSON')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.ursula();
      if (opts.json) { printJson(result); return; }
      console.log('\n' + result.summary + '\n');
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(2);
    }
  });

/* ── init ── */
program
  .command('init')
  .description('Initialize HYDI for this project (creates .env template)')
  .option('--token <token>', 'Your HYDI API token (from protoforgeindustries.com)')
  .action(async (opts) => {
    const fs = require('fs');
    const envPath = './.env';

    if (fs.existsSync(envPath)) {
      console.log('⚠️  .env already exists. Add these variables manually:\n');
    } else {
      fs.writeFileSync(envPath, [
        '# HYDI Configuration — ProtoForge Industries',
        '# Get your keys from https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api',
        '',
        'SUPABASE_URL=https://your-project.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY=your-service-role-key',
        '',
        `HYDI_TOKEN=${opts.token || 'your-hydi-token'}`,
        'HYDI_ENV=production',
        '',
      ].join('\n'));
      console.log('✅ .env created. Fill in your Supabase credentials, then run:\n');
    }

    console.log('  hydi check      — run health check');
    console.log('  hydi dashboard  — view full dashboard');
    console.log('  hydi trends     — analyze trends');
    console.log('  hydi heal       — trigger auto-heal');
    console.log('  hydi ursula     — AI agent summary');
    console.log('');
  });

program.parse(process.argv);
