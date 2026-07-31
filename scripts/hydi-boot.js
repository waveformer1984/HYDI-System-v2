#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const path = require('path');
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');

function parseArgs(argv) {
  const flags = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data-path' && argv[i + 1]) { flags.dataPath = argv[i + 1]; i += 1; }
    else if (arg === '--priority' && argv[i + 1]) { flags.priority = argv[i + 1]; i += 1; }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv);
  const dataPath = flags.dataPath
    ? path.resolve(process.cwd(), flags.dataPath)
    : path.resolve(__dirname, '..', 'data');
  const cwd = process.cwd();

  const runtime = new HYDIContinuousRuntime({
    dataPath,
    ownerPriority: flags.priority || 'default',
    logger: {
      log: (m) => console.log(`[HYDI] ${m}`),
      warn: (m) => console.warn(`[HYDI] ${m}`),
      error: (m) => console.error(`[HYDI] ${m}`),
    },
    connectors: [
      { type: 'local-process', name: 'process', enabled: true },
      { type: 'filesystem', name: 'filesystem', enabled: true, roots: { [path.basename(cwd)]: cwd } },
      { type: 'git', name: 'git', enabled: true, cwd, project: path.basename(cwd), pollIntervalMs: 60000 },
    ],
  });

  await runtime.start();
  const status = runtime.getStatus();
  console.log(`HYDI booted. State: ${status.state}. Connectors: ${status.connectors.length}.`);
  console.log('Press Ctrl+C to shutdown.');

  const shutdown = async () => {
    console.log('\nShutting down...');
    await runtime.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
