/**
 * Live kill switch test — forks the daemon as a child process,
 * lets it run a few cycles, activates the kill switch via IPC,
 * verifies that autonomous actions stop, then deactivates it
 * and verifies that autonomous actions resume.
 *
 * Uses child_process.fork() which supports IPC (process.send).
 */
import { fork } from 'child_process';
import path from 'path';

const daemonPath = path.resolve(__dirname, 'heidi-daemon.ts');

// Fork the daemon with IPC enabled
const child = fork(daemonPath, ['--interval=3000', '--no-stabilization'], {
  stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
  execArgv: ['--import', 'tsx'],
});

let output = '';
let cycleCount = 0;
let killSwitchActive = false;
let killSwitchConfirmed = false;
let resumeConfirmed = false;

child.stdout?.on('data', (data: Buffer) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);

  // Track cycles
  const cycleMatch = text.match(/cycles=(\d+)/);
  if (cycleMatch) {
    cycleCount = parseInt(cycleMatch[1], 10);
  }

  // Track kill switch state in status output
  if (text.includes('kill=true')) {
    killSwitchActive = true;
    killSwitchConfirmed = true;
  }
  if (text.includes('kill=false') && killSwitchConfirmed) {
    resumeConfirmed = true;
  }
});

child.stderr?.on('data', (data: Buffer) => {
  process.stderr.write(data);
});

async function run() {
  console.log('\n=== LIVE KILL SWITCH TEST ===\n');

  // Wait for daemon to start and run a few cycles
  console.log('[test] Waiting 15s for daemon to start and run initial cycles...');
  await new Promise((r) => setTimeout(r, 15000));

  console.log(`[test] Daemon running. Cycles: ${cycleCount}`);

  // Verify daemon is running normally before kill switch
  const preKillEscalations = (output.match(/Escalated/g) || []).length;
  console.log(`[test] Pre-kill escalations: ${preKillEscalations}`);

  console.log('[test] Activating kill switch via IPC...');
  child.send({ type: 'kill_switch', reason: 'live kill switch test' });

  // Wait for kill switch to take effect (need enough time for at least
  // 2 self-sufficiency cycles to prove they were suppressed)
  await new Promise((r) => setTimeout(r, 12000));

  const postKillEscalations = (output.match(/Escalated/g) || []).length;
  console.log(`[test] Post-kill total escalations: ${postKillEscalations} (was ${preKillEscalations})`);

  // Check if the kill switch message was logged
  const killSwitchLogged = output.includes('Kill switch activated via IPC');
  console.log(`[test] Kill switch logged: ${killSwitchLogged}`);

  // Check if self-sufficiency was suspended
  const ssfSuspended = output.includes('Kill switch active — self-sufficiency actions suspended');
  console.log(`[test] Self-sufficiency suspended message: ${ssfSuspended}`);

  // Check status output for kill=true
  console.log(`[test] killSwitchActive in status: ${killSwitchActive}`);

  // Verify NO new escalations occurred after kill switch
  // This is the PRIMARY behavioral evidence — if the kill switch works,
  // no autonomous actions (escalations) should occur while it's active.
  const escalationsDuringKill = postKillEscalations - preKillEscalations;
  console.log(`[test] Escalations during kill switch: ${escalationsDuringKill}`);

  console.log('[test] Deactivating kill switch via IPC...');
  child.send({ type: 'kill_switch_off' });

  // Wait for resume (need enough time for at least 2 cycles to prove
  // autonomous actions resumed)
  await new Promise((r) => setTimeout(r, 12000));

  const postResumeEscalations = (output.match(/Escalated/g) || []).length;
  const escalationsAfterResume = postResumeEscalations - postKillEscalations;
  console.log(`[test] Post-resume total escalations: ${postResumeEscalations} (was ${postKillEscalations})`);
  console.log(`[test] Escalations after resume: ${escalationsAfterResume}`);
  console.log(`[test] Resume confirmed (kill=false in status): ${resumeConfirmed}`);

  // Check if the deactivation was logged
  const killSwitchOffLogged = output.includes('Kill switch deactivated via IPC');
  console.log(`[test] Kill switch off logged: ${killSwitchOffLogged}`);

  // Results
  console.log('\n=== KILL SWITCH TEST RESULTS ===\n');
  const results = {
    'Kill switch activated via IPC': killSwitchLogged,
    'No autonomous actions during kill switch': escalationsDuringKill === 0,
    'Kill switch deactivated via IPC': killSwitchOffLogged,
    'Autonomous actions resumed after deactivation': escalationsAfterResume > 0,
    'Daemon survived kill switch cycle': cycleCount > 0,
  };

  let allPassed = true;
  for (const [name, passed] of Object.entries(results)) {
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name}`);
    if (!passed) allPassed = false;
  }

  // Shutdown daemon
  console.log('\n[test] Sending shutdown message...');
  child.send('shutdown');

  await new Promise((r) => setTimeout(r, 5000));
  child.kill('SIGKILL');

  console.log(`\n=== OVERALL: ${allPassed ? 'PASS' : 'FAIL'} ===\n`);
  process.exit(allPassed ? 0 : 1);
}

run().catch((e) => {
  console.error('Test failed:', e);
  child.kill('SIGKILL');
  process.exit(1);
});
