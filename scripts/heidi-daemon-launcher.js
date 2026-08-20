/**
 * JS wrapper to launch the HEIDI daemon TypeScript file via tsx.
 *
 * PM2 on Windows can't directly run the .bin/tsx shim, so this wrapper
 * spawns tsx with the daemon script. Critically, it uses child_process.fork()
 * instead of spawn() to establish an IPC channel between this launcher and
 * the daemon child process.
 *
 * Why IPC instead of signal relay:
 *   On Windows, child_process.kill(signal) does not deliver a catchable
 *   signal — Windows has no POSIX signal mechanism, so regardless of which
 *   signal string is passed, the child is terminated unconditionally
 *   (like TerminateProcess()). Additionally, PM2's default stop behavior
 *   on Windows uses `taskkill /pid <pid> /T /F` (force kill the entire
 *   process tree), which gives no chance for graceful shutdown at all.
 *
 *   With `shutdown_with_message: true` in ecosystem.config.js, PM2 calls
 *   proc.send('shutdown') on this launcher process instead of force-killing.
 *   PM2 then waits up to kill_timeout (50s) for the process to exit on its
 *   own before falling back to SIGKILL. This launcher relays the shutdown
 *   message to the daemon child via IPC, giving the daemon a chance to run
 *   its graceful shutdown handler (wait for in-flight work, record audit,
 *   release lock).
 *
 *   The launcher also keeps the SIGINT handler for direct (non-PM2)
 *   invocation, since Ctrl+C from a terminal IS reliably delivered on
 *   Windows via console events.
 */
const { fork } = require('child_process');
const path = require('path');

const tsxPath = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const daemonPath = path.resolve(__dirname, 'heidi-daemon.ts');

// Pass through all args after 'node launcher.js'
const args = [daemonPath, ...process.argv.slice(2)];

// Use fork() to establish an IPC channel with the child.
// We run tsx as the module, with the daemon path as the first arg.
// fork() sets up stdio: ['inherit','inherit','inherit','ipc'] by default.
const child = fork(tsxPath, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  execPath: process.execPath,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

// Relay PM2's shutdown message to the daemon child via IPC.
// PM2 sends 'shutdown' (a string) when shutdown_with_message is true.
process.on('message', (msg) => {
  if (msg === 'shutdown' || (msg && msg.type === 'shutdown')) {
    const receivedAt = Date.now();
    console.log(`[launcher] Shutdown message received from PM2 at ${new Date().toISOString()} (epoch ms: ${receivedAt})`);
    // Send a structured message that the daemon's process.on('message')
    // handler will recognize.
    try {
      child.send({ type: 'shutdown' });
      console.log(`[launcher] Shutdown message sent to daemon child at ${new Date().toISOString()} (epoch ms: ${Date.now()})`);
    } catch (e) {
      // Child may have already exited — fall through to exit
      console.error('[launcher] Failed to send shutdown to child:', e instanceof Error ? e.message : 'unknown');
      process.exit(0);
    }
  }
});

// SIGINT (Ctrl+C) IS reliably delivered on Windows via console events.
// Keep this for direct (non-PM2) invocation.
process.on('SIGINT', () => {
  try {
    child.send({ type: 'shutdown' });
  } catch {
    // If IPC fails, fall back to kill
    child.kill('SIGINT');
  }
});
