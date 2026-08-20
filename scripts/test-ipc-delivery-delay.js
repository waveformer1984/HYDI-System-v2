/**
 * IPC delivery delay distribution test.
 *
 * Spawns the daemon launcher via fork() (same as PM2 does), waits for a
 * cognitive cycle to be in-flight, sends the shutdown IPC message, and
 * measures:
 *   - IPC delivery delay: time from launcher.send() to daemon's IPC receipt
 *   - Total shutdown duration: time from launcher.send() to process exit
 *
 * Runs N iterations in two conditions:
 *   1. Idle: machine otherwise quiet
 *   2. Loaded: CPU-bound background process saturating one core
 *
 * The launcher instrumentation logs timestamps for:
 *   - "Shutdown message received from PM2 at <ISO> (epoch ms: <n>)"
 *   - "Shutdown message sent to daemon child at <ISO> (epoch ms: <n>)"
 * The daemon instrumentation logs:
 *   - "IPC message received at <ISO> (epoch ms: <n>)"
 *   - "Shutdown complete (total shutdown duration: <n>ms)"
 *
 * We parse these from stdout to compute delivery delay.
 *
 * Usage:
 *   node scripts/test-ipc-delivery-delay.js --samples=20 --condition=idle
 *   node scripts/test-ipc-delivery-delay.js --samples=20 --condition=loaded
 *   node scripts/test-ipc-delivery-delay.js --samples=20 --condition=both
 */

const { fork, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const LAUNCHER = path.resolve(REPO_ROOT, 'scripts', 'heidi-daemon-launcher.js');
const LOCK_FILE = path.resolve(REPO_ROOT, '.heidi-daemon.lock');
const AUDIT_FILE = path.resolve(REPO_ROOT, '.heidi-daemon-audit.jsonl');

// Parse args
const args = process.argv.slice(2);
let numSamples = 20;
let condition = 'both';
for (const arg of args) {
  if (arg.startsWith('--samples=')) numSamples = parseInt(arg.split('=')[1], 10);
  else if (arg.startsWith('--condition=')) condition = arg.split('=')[1];
}

const conditions = condition === 'both' ? ['idle', 'loaded'] : [condition];

// Use a short interval (5s) so cognitive cycles run frequently,
// increasing the chance of catching one in-flight.
const DAEMON_INTERVAL_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

function cleanup() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockData = JSON.parse(content);
      if (lockData._test) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch { /* best effort */ }
}

/**
 * Spawn a CPU-bound background process to create load.
 * Runs a tight loop computing primes.
 */
function startLoadProcess() {
  const loadProc = spawn('node', ['-e', `
    // CPU-bound prime sieve to saturate one core
    let count = 0;
    function isPrime(n) {
      if (n < 2) return false;
      for (let i = 2; i * i <= n; i++) {
        if (n % i === 0) return false;
      }
      return true;
    }
    let n = 2;
    while (true) {
      if (isPrime(n)) count++;
      n++;
      if (n > 1000000) n = 2; // wrap to keep going
    }
  `], { stdio: 'ignore', detached: true });
  return loadProc;
}

/**
 * Run a single IPC delivery delay sample.
 * Spawns the daemon, waits for a cycle to be in-flight, sends shutdown,
 * and parses the timing from stdout.
 *
 * Returns { ipcDeliveryMs, totalShutdownMs, caughtInFlight } or null on failure.
 */
async function runSample(sampleNum) {
  // Clean up before each sample
  cleanup();
  try { fs.unlinkSync(AUDIT_FILE); } catch { /* may not exist */ }

  return new Promise((resolve) => {
    const child = fork(LAUNCHER, [
      '--no-stabilization',
      `--interval=${DAEMON_INTERVAL_MS}`,
    ], {
      stdio: 'pipe',
      cwd: REPO_ROOT,
    });

    child.on('error', () => { resolve(null); });

    let stdout = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });

    // Safety timeout — if daemon doesn't start in 30s, give up.
    // This is cleared once the daemon is ready.
    let startupTimeout = setTimeout(() => {
      clearInterval(readyCheck);
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
      resolve(null);
    }, 30000);

    // Wait for daemon to be ready, then wait for a cycle to start,
    // then send shutdown.
    const readyCheck = setInterval(() => {
      if (stdout.includes('Daemon is running')) {
        clearInterval(readyCheck);
        clearTimeout(startupTimeout);
        // Wait for the first cognitive cycle to start (interval boundary)
        // With 5s interval and 0 stabilization, first cycle starts at ~5s.
        // Wait 7s to be ~2s into the cycle.
        sleep(7000).then(() => {
          try {
            child.send({ type: 'shutdown' });
          } catch {
            // Child may have exited
            resolve(null);
            return;
          }

          // Wait for exit (up to 45s for safety — daemon may wait
          // up to 31s for in-flight work)
          const exitTimeout = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* best effort */ }
            resolve(null);
          }, 45000);

          child.on('exit', () => {
            clearTimeout(exitTimeout);
            // Parse timing from stdout
            const launcherSentMatch = stdout.match(/Shutdown message sent to daemon child at \S+ \(epoch ms: (\d+)\)/g);
            const daemonReceivedMatch = stdout.match(/IPC message received at \S+ \(epoch ms: (\d+)\)/g);
            const shutdownCompleteMatch = stdout.match(/Shutdown complete \(total shutdown duration: (\d+)ms\)/g);
            const waitingMatch = stdout.match(/Waiting for in-flight work/g);

            if (!launcherSentMatch || !daemonReceivedMatch || !shutdownCompleteMatch) {
              resolve(null);
              return;
            }

            const launcherSentEpoch = parseInt(
              launcherSentMatch[launcherSentMatch.length - 1].match(/epoch ms: (\d+)/)[1], 10
            );
            const daemonReceivedEpoch = parseInt(
              daemonReceivedMatch[daemonReceivedMatch.length - 1].match(/epoch ms: (\d+)/)[1], 10
            );
            const totalShutdownMs = parseInt(
              shutdownCompleteMatch[shutdownCompleteMatch.length - 1].match(/duration: (\d+)ms/)[1], 10
            );

            const ipcDeliveryMs = daemonReceivedEpoch - launcherSentEpoch;
            const caughtInFlight = waitingMatch !== null;

            resolve({ ipcDeliveryMs, totalShutdownMs, caughtInFlight });
          });
        });
      }
    }, 200);
  });
}

async function runCondition(condName, numSamples) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Condition: ${condName.toUpperCase()} (${numSamples} samples)`);
  console.log(`${'═'.repeat(70)}`);

  let loadProc = null;
  if (condName === 'loaded') {
    console.log('[setup] Starting CPU-bound load process...');
    loadProc = startLoadProcess();
    // Give the load process a moment to ramp up
    await sleep(2000);
  }

  const results = [];
  for (let i = 0; i < numSamples; i++) {
    process.stdout.write(`  Sample ${i + 1}/${numSamples}... `);
    const result = await runSample(i + 1);
    if (result) {
      results.push(result);
      console.log(`IPC=${result.ipcDeliveryMs}ms, shutdown=${result.totalShutdownMs}ms, inFlight=${result.caughtInFlight}`);
    } else {
      console.log('FAILED');
    }
    // Brief pause between samples
    await sleep(1000);
  }

  if (loadProc) {
    try { loadProc.kill('SIGKILL'); } catch { /* best effort */ }
    console.log('[cleanup] Load process killed');
  }

  // Compute statistics
  const deliveryDelays = results.map(r => r.ipcDeliveryMs).sort((a, b) => a - b);
  const shutdownDurations = results.map(r => r.totalShutdownMs).sort((a, b) => a - b);
  const inFlightCount = results.filter(r => r.caughtInFlight).length;

  console.log(`\n--- Results: ${condName.toUpperCase()} ---`);
  console.log(`  Samples collected:      ${results.length}/${numSamples}`);
  console.log(`  Caught in-flight:       ${inFlightCount}/${results.length}`);
  console.log(`  IPC delivery delay (ms):`);
  console.log(`    min:  ${deliveryDelays[0] || 0}`);
  console.log(`    p50:  ${percentile(deliveryDelays, 50)}`);
  console.log(`    p95:  ${percentile(deliveryDelays, 95)}`);
  console.log(`    max:  ${deliveryDelays[deliveryDelays.length - 1] || 0}`);
  console.log(`  Total shutdown duration (ms):`);
  console.log(`    min:  ${shutdownDurations[0] || 0}`);
  console.log(`    p50:  ${percentile(shutdownDurations, 50)}`);
  console.log(`    p95:  ${percentile(shutdownDurations, 95)}`);
  console.log(`    max:  ${shutdownDurations[shutdownDurations.length - 1] || 0}`);

  return {
    condition: condName,
    samples: results.length,
    inFlightCount,
    deliveryDelays,
    shutdownDurations,
    deliveryMin: deliveryDelays[0] || 0,
    deliveryP50: percentile(deliveryDelays, 50),
    deliveryP95: percentile(deliveryDelays, 95),
    deliveryMax: deliveryDelays[deliveryDelays.length - 1] || 0,
    shutdownMin: shutdownDurations[0] || 0,
    shutdownP50: percentile(shutdownDurations, 50),
    shutdownP95: percentile(shutdownDurations, 95),
    shutdownMax: shutdownDurations[shutdownDurations.length - 1] || 0,
  };
}

async function main() {
  // Ensure no stale daemon is running
  try {
    execSync('pm2 stop hydi-daemon 2>nul', { stdio: 'ignore' });
  } catch { /* may not be running */ }
  cleanup();

  console.log('IPC Delivery Delay Distribution Test');
  console.log(`Samples per condition: ${numSamples}`);
  console.log(`Conditions: ${conditions.join(', ')}`);
  console.log(`Daemon interval: ${DAEMON_INTERVAL_MS}ms (short to increase in-flight probability)`);

  const allResults = [];
  for (const cond of conditions) {
    const result = await runCondition(cond, numSamples);
    allResults.push(result);
  }

  // Final summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log('FINAL SUMMARY');
  console.log(`${'═'.repeat(70)}`);
  console.log('Condition   | p50 delivery | p95 delivery | max delivery | p95 shutdown | max shutdown | in-flight');
  console.log('------------|-------------|-------------|-------------|-------------|-------------|----------');
  for (const r of allResults) {
    console.log(
      `${r.condition.padEnd(11)} | ` +
      `${String(r.deliveryP50).padStart(11)} | ` +
      `${String(r.deliveryP95).padStart(11)} | ` +
      `${String(r.deliveryMax).padStart(11)} | ` +
      `${String(r.shutdownP95).padStart(11)} | ` +
      `${String(r.shutdownMax).padStart(11)} | ` +
      `${r.inFlightCount}/${r.samples}`
    );
  }

  // Budget check
  console.log(`\n--- Timing Budget Check ---`);
  console.log(`  Current kill_timeout:          50000ms`);
  console.log(`  Current SHUTDOWN_WAIT_TIMEOUT: 31000ms`);
  for (const r of allResults) {
    const worstCase = r.deliveryMax + r.shutdownMax;
    const margin = 50000 - worstCase;
    const marginPct = ((margin / 50000) * 100).toFixed(1);
    console.log(`  ${r.condition}: worst case (max delivery + max shutdown) = ${worstCase}ms, margin = ${margin}ms (${marginPct}%)`);
  }

  cleanup();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  cleanup();
  process.exit(1);
});
