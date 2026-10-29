/**
 * Load the TypeScript daemon in this process.
 *
 * PM2 owns this exact PID. There is deliberately no child process: a child
 * could outlive a PM2 restart while retaining the file lock and DB lease.
 * Registering tsx's CJS hook keeps the Windows-safe JavaScript entry point
 * while the daemon receives PM2 IPC messages and termination signals itself.
 */
require('tsx/cjs');
// Register tsx's ESM loader hook in-process as well: every
// `await import('../lib/...')` of an extensionless .ts file
// (CredentialRunbookRegistry, ExternalCapabilityAcquisitionEngine,
// delegated-operator, AgentControlPlane) resolves without PM2 needing
// `--import tsx` in node_args. The launcher owns both hooks.
require('tsx/esm/api').register();
require('./heidi-daemon.ts');
