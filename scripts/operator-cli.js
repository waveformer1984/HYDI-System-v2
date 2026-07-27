#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Unified Operator CLI for the ProtoForge executive stack.
 *
 * Boots the full executive stack through a single OperatorSession, then
 * exposes it as a readline prompt. The terminal lifecycle (queueing, history,
 * signals, graceful shutdown) lives in src/hydi-v3/OperatorRuntime.js so it is
 * unit-testable; this file only parses argv and wires things together.
 *
 * Usage:
 *   npm run cockpit
 *   node scripts/operator-cli.js --priority resonate
 *   node scripts/operator-cli.js --once "good morning"
 *   node scripts/operator-cli.js --dry-run
 *   node scripts/operator-cli.js --offline
 *
 * Flags:
 *   --priority <p>   Owner priority: resonate | operations | manufacturing |
 *                    music | research | revenue | creative | default
 *   --once <cmd>     Run a single command, print the result, exit
 *   --no-colour      Plain text output (also honours NO_COLOR)
 *   --data-path <p>  Override the persistence directory
 *   --dry-run        Simulate or refuse every mutating action; execute nothing
 *   --offline        Refuse network-dependent actions and verify local-only
 *   --no-history     Do not seed or persist readline history
 *   --git [path]     Attach the Git sensor to a repository (defaults to cwd)
 *   --git-poll <ms>  Git poll interval (default 60000; 0 disables polling)
 *   --git-project <name>  Project label for git signals (default: directory
 *                    name). Set this to match a strategic objective — e.g.
 *                    "Resonate" — so commits score against the right objective
 *                    instead of falling through to "default".
 *   --simulate-manufacturing  Run the printer sensor in simulation mode and
 *                    emit realistic manufacturing events.
 *   --revenue-ledger <file>  Load revenue from a JSON or CSV ledger file
 *   --revenue-format <json|csv>  Ledger format (default: json)
 *   --shutdown-timeout <ms>  Bound the graceful shutdown drain (default 10000)
 *
 * All actions still route through ExecutionGateway approval rules. The CLI is
 * an interface, not an authority escalation path.
 */

const path = require('path');
const OperatorSession = require('../src/hydi-v3/OperatorSession');
const OperatorCLI = require('../src/hydi-v3/OperatorCLI');
const OperatorMode = require('../src/hydi-v3/OperatorMode');
const OperatorRuntime = require('../src/hydi-v3/OperatorRuntime');
const { JSONLedgerAdapter, CSVLedgerAdapter } = require('../src/hydi-v3/RevenueSensor');

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

/**
 * Sensors are opt-in: `--git` with no value watches the current directory,
 * `--git <path>` watches that repository. Absent the flag, no sensor starts and
 * the event bus simply carries no git events.
 */
function gitConfig(flags) {
  if (!flags.git) return null;
  return {
    cwd: typeof flags.git === 'string' ? path.resolve(process.cwd(), flags.git) : process.cwd(),
    pollIntervalMs: flags['git-poll'] !== undefined ? Number(flags['git-poll']) : undefined,
    project: typeof flags['git-project'] === 'string' ? flags['git-project'] : undefined,
  };
}

function revenueConfig(flags) {
  const ledger = flags['revenue-ledger'];
  if (!ledger) return null;
  const format = String(flags['revenue-format'] || 'json').toLowerCase();
  const resolved = path.resolve(process.cwd(), String(ledger));
  const Adapter = format === 'csv' ? CSVLedgerAdapter : JSONLedgerAdapter;
  return {
    adapters: [new Adapter({ path: resolved })],
    pollMs: 0,
  };
}

function filesystemConfig(flags) {
  if (!flags.filesystem) return null;
  const root = typeof flags.filesystem === 'string'
    ? path.resolve(process.cwd(), flags.filesystem)
    : process.cwd();
  const project = typeof flags['filesystem-project'] === 'string' ? flags['filesystem-project'] : 'default';
  return {
    roots: { [project]: root },
    scanIntervalMs: Number(flags['filesystem-poll']) || 30000,
    watch: flags['filesystem-watch'] !== 'false',
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const colour = !(flags['no-colour'] || flags['no-color'] || process.env.NO_COLOR)
    && process.stdout.isTTY !== false;

  const mode = new OperatorMode({
    dryRun: !!flags['dry-run'],
    offline: !!flags.offline,
  });

  const session = new OperatorSession({
    dataPath: flags['data-path']
      ? path.resolve(process.cwd(), String(flags['data-path']))
      : path.resolve(__dirname, '..', 'data'),
    ownerPriority: typeof flags.priority === 'string' ? flags.priority : 'default',
    mode,
    git: gitConfig(flags),
    filesystem: filesystemConfig(flags),
    simulateManufacturing: !!flags['simulate-manufacturing'],
    revenue: revenueConfig(flags),
  });

  await session.start();
  const cli = new OperatorCLI(session, { colour });

  // --once is a one-shot: no readline, no history, but the same shutdown path.
  if (typeof flags.once === 'string') {
    const result = await cli.handle(flags.once);
    if (result.output) console.log(result.output);
    if (mode.dryRun) {
      const summary = mode.summary();
      if (summary) console.log(`\n${summary}`);
    }
    const shutdownResult = await session.shutdown();
    process.exit(result.error || !shutdownResult.ok ? 1 : 0);
    return;
  }

  console.log(cli.banner);
  if (session.gitSensor) {
    const health = session.gitSensor.healthCheck();
    console.log(health.checks.repositoryAvailable
      ? `Git sensor: watching ${session.gitSensor.cwd} as "${session.gitSensor.project}"`
      : `Git sensor: inactive (${health.unavailableReason})`);
  }
  if (session.printerSensor) {
    const health = session.printerSensor.healthCheck();
    console.log(health.simulating
      ? `Printer sensor: simulation mode (${health.equipmentName})`
      : `Printer sensor: monitoring ${health.equipmentName}`);
  }
  if (session.filesystemMonitor) {
    const projects = Object.keys(session.filesystemMonitor.config.roots || {});
    console.log(`Filesystem sensor: watching ${projects.join(', ')}`);
  }
  if (mode.enabled) {
    console.log(`Mode: ${mode.describe()}`);
    const offlineCheck = mode.verifyOffline(session);
    if (offlineCheck) {
      console.log(`Offline preflight: ${offlineCheck.ok ? 'OK' : 'WARNING'} — ${offlineCheck.detail}`);
    }
  }
  console.log('');

  const runtime = new OperatorRuntime({
    session,
    cli,
    mode,
    shutdownTimeoutMs: flags['shutdown-timeout']
      ? Number(flags['shutdown-timeout'])
      : undefined,
    history: !flags['no-history'],
  });

  runtime.start();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
