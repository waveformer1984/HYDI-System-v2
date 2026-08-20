/**
 * JS wrapper to launch the HEIDI daemon TypeScript file via tsx.
 * PM2 on Windows can't directly run the .bin/tsx shim with interpreter:'none',
 * so this small JS file spawns tsx with the daemon script and passes
 * through all command-line arguments.
 */
const { spawn } = require('child_process');
const path = require('path');

const tsxPath = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const daemonPath = path.resolve(__dirname, 'heidi-daemon.ts');

// Pass through all args after 'node launcher.js'
const args = [tsxPath, daemonPath, ...process.argv.slice(2)];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

// Forward signals to child for graceful shutdown
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGQUIT', () => child.kill('SIGQUIT'));
