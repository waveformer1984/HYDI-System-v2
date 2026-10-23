/**
 * Load the TypeScript daemon in this process.
 *
 * PM2 owns this exact PID. There is deliberately no child process: a child
 * could outlive a PM2 restart while retaining the file lock and DB lease.
 * Registering tsx's CJS hook keeps the Windows-safe JavaScript entry point
 * while the daemon receives PM2 IPC messages and termination signals itself.
 */
require('tsx/cjs');
require('./heidi-daemon.ts');
