/**
 * Phase 13 — Live Operational Integration Qualification
 */

const fs = require('fs');
const path = require('path');
const { HeidiExecutive, OperationalLoop } = require('../src/heidi-executive');

const REPORT_DIR = path.join(process.cwd(), 'reports', 'phase13');
const DECISION_ONLY = process.argv.includes('--decision-only');
const SHADOW = process.argv.includes('--shadow');
const CONTROLLED = process.argv.includes('--controlled');
const SOAK = process.argv.includes('--soak');
const INJECT_TARGET = process.env.PHASE13_INJECT_TARGET || null;
const INJECT_REDIS = process.env.PHASE13_INJECT_REDIS === '1' || INJECT_TARGET === 'redis';
const INJECT_PROTOHUB = process.env.PHASE13_INJECT_PROTOHUB === '1' || INJECT_TARGET === 'protohub-api';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const executive = new HeidiExecutive({
    dataDir: REPORT_DIR,
    manifestPath: path.join(process.cwd(), 'services-manifest.json'),
  });

  if (DECISION_ONLY) {
    console.log('[Phase13] Running DECISION_ONLY cycle...');
    const result = await executive.operationalCycle('DECISION_ONLY', { cycleId: 'phase13-decision-only' });
    const file = path.join(REPORT_DIR, 'decision-only.json');
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(`[Phase13] DECISION_ONLY: ${result.decisions.length} decision records → ${file}`);
  }

  if (SHADOW) {
    const minutes = parseInt(process.env.PHASE13_SHADOW_MINUTES || '5', 10);
    console.log(`[Phase13] Running SHADOW soak for ${minutes} minute(s)...`);
    const loop = new OperationalLoop(executive, {
      reportDir: REPORT_DIR,
      cycleIntervalMs: 30000,
      maxCycles: 1000,
      maxActionsPerCycle: 0,
    });
    const result = await loop.run('SHADOW', minutes * 60000);
    console.log('[Phase13] SHADOW summary:', JSON.stringify(result.summary, null, 2));
  }

  if (CONTROLLED) {
    const { execFile } = require('child_process');
    const composeFile = 'C:\\ProtoForge_Ecosystem\\Ursula_Suite\\docker-compose.yml';
    if (INJECT_REDIS) {
      console.log('[Phase13] Injecting Redis failure for controlled recovery...');
      await new Promise((resolve, reject) => {
        execFile('docker', ['compose', '-f', composeFile, 'stop', 'redis'], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await sleep(5000);
    } else if (INJECT_PROTOHUB) {
      console.log('[Phase13] Injecting ProtoHub failure for controlled recovery...');
      await new Promise((resolve, reject) => {
        execFile('docker', ['compose', '-f', composeFile, 'stop', 'protohub-api'], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await sleep(5000);
    }

    console.log('[Phase13] Running CONTROLLED recovery loop...');
    const loop = new OperationalLoop(executive, {
      reportDir: REPORT_DIR,
      cycleIntervalMs: 15000,
      maxCycles: 6,
      maxActionsPerCycle: 1,
    });
    const result = await loop.run('CONTROLLED');
    console.log('[Phase13] CONTROLLED summary:', JSON.stringify(result.summary, null, 2));
  }

  if (SOAK) {
    const minutes = parseInt(process.env.PHASE13_SOAK_MINUTES || '15', 10);
    console.log(`[Phase13] Running ${minutes}-minute SHADOW soak...`);
    const loop = new OperationalLoop(executive, {
      reportDir: REPORT_DIR,
      cycleIntervalMs: 30000,
      maxCycles: 1000,
      maxActionsPerCycle: 0,
    });
    const result = await loop.run('SHADOW', minutes * 60000);
    console.log('[Phase13] SOAK summary:', JSON.stringify(result.summary, null, 2));
  }

  if (!DECISION_ONLY && !SHADOW && !CONTROLLED && !SOAK) {
    console.log('[Phase13] No mode selected. Use --decision-only, --shadow, --controlled, or --soak.');
  }
}

main().catch((e) => {
  console.error('[Phase13] Fatal:', e);
  process.exit(1);
});
