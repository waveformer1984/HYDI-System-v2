#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Unified Operator CLI for the ProtoForge executive stack.
 *
 * Boots BusinessMemory, ExecutiveOperatingSystem, TaskEngine,
 * BusinessWorkflowEngine, ExecutionGateway and ExecutiveCockpit through a
 * single OperatorSession, then exposes them as a readline prompt.
 *
 * Usage:
 *   npm run cockpit
 *   node scripts/operator-cli.js
 *   node scripts/operator-cli.js --priority resonate
 *   node scripts/operator-cli.js --no-colour
 *   node scripts/operator-cli.js --once "good morning"
 *   node scripts/operator-cli.js --data-path ./data
 *
 * Flags:
 *   --priority <p>   Owner priority: resonate | operations | manufacturing |
 *                    music | research | revenue | creative | default
 *   --once <cmd>     Run a single command, print the result, exit
 *   --no-colour      Plain text output (also honours NO_COLOR)
 *   --data-path <p>  Override the persistence directory
 *
 * All actions still route through ExecutionGateway approval rules. The CLI is
 * an interface, not an authority escalation path.
 */

const path = require('path');
const readline = require('readline');
const OperatorSession = require('../src/hydi-v3/OperatorSession');
const OperatorCLI = require('../src/hydi-v3/OperatorCLI');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const colour = !(flags['no-colour'] || flags['no-color'] || process.env.NO_COLOR)
    && process.stdout.isTTY !== false;

  const session = new OperatorSession({
    dataPath: flags['data-path']
      ? path.resolve(process.cwd(), String(flags['data-path']))
      : path.resolve(__dirname, '..', 'data'),
    ownerPriority: typeof flags.priority === 'string' ? flags.priority : 'default',
  });

  await session.start();
  const cli = new OperatorCLI(session, { colour });

  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await session.destroy();
    process.exit(code);
  };

  if (typeof flags.once === 'string') {
    const result = await cli.handle(flags.once);
    if (result.output) console.log(result.output);
    await shutdown(result.error ? 1 : 0);
    return;
  }

  console.log(cli.banner);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'cockpit> ',
  });

  rl.prompt();

  // Commands are handled asynchronously, so line events are serialised through
  // a promise chain. Without this, piped or pasted input would interleave
  // responses and could run "exit" before earlier commands finished.
  let queue = Promise.resolve();
  let closed = false;

  rl.on('line', (line) => {
    queue = queue.then(async () => {
      if (closed) return;
      const result = await cli.handle(line);
      if (result.output) {
        console.log('');
        console.log(result.output);
        console.log('');
      }
      if (result.done) {
        closed = true;
        rl.close();
        return;
      }
      rl.prompt();
    });
  });

  rl.on('close', () => {
    closed = true;
    // Let any in-flight command finish writing before tearing the stack down.
    queue = queue.then(() => shutdown(0), () => shutdown(1));
  });

  process.on('SIGINT', () => {
    rl.close();
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
