#!/usr/bin/env node
'use strict';
/**
 * Mission CLI -- create/list/cancel missions without going through the
 * LLM chat tool-loop (create_mission is a real tool, but a full /chat-tools
 * round-trip is 50-100s+ on this box just to place one row in a queue).
 * Talks to the SAME database heidi-core uses by default
 * (heidi-core/data/heidi_memory.db) -- if heidi-core is running, a created
 * mission is picked up by its next poll cycle same as any other.
 *
 * Usage:
 *   node scripts/mission-cli.js create "<goal>" [--priority 0-3]
 *       [--assign <agent>] [--action '<json>']
 *   node scripts/mission-cli.js list [--status pending|active|blocked|completed|failed|cancelled] [--limit N]
 *   node scripts/mission-cli.js cancel <id>
 *
 * Examples:
 *   node scripts/mission-cli.js create "restart mobile chat" --priority 2 \
 *     --assign Heidi --action '{"type":"run_script","target":"scripts/restart-module.js","args":["heidi-mobile-chat"]}'
 *   node scripts/mission-cli.js list --status pending
 *   node scripts/mission-cli.js cancel 12
 *
 * Attaching --action without --assign is refused, same rule the
 * create_mission chat tool enforces: a structured action needs an assigned
 * agent so the mission worker has something to check permission_level
 * against. Attaching an action does not grant that agent anything -- the
 * worker still requires the assigned agent to independently already hold
 * sufficient permission_level, and still re-validates with isSafe().
 */

const path = require('path');
const HeidiMemory = require('../heidi-core/memory/sqlite-store');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function printMission(m) {
  const line = `#${m.id} [${m.status}] pri=${m.priority} agent=${m.assigned_agent || '-'}  ${m.goal}`;
  console.log(line);
  if (m.result) {
    const preview = m.result.length > 200 ? m.result.slice(0, 200) + '...' : m.result;
    console.log(`    result: ${preview}`);
  }
}

async function cmdCreate(memory, argv) {
  const goal = argv[0];
  if (!goal) {
    console.error('Usage: mission-cli.js create "<goal>" [--priority N] [--assign <agent>] [--action \'<json>\']');
    process.exit(1);
  }
  const flags = parseFlags(argv.slice(1));
  const priority = flags.priority !== undefined ? parseInt(flags.priority, 10) : 1;

  let action = null;
  if (flags.action) {
    try {
      action = JSON.parse(flags.action);
    } catch (e) {
      console.error(`--action is not valid JSON: ${e.message}`);
      process.exit(1);
    }
  }
  if (action && !flags.assign) {
    console.error('--assign <agent> is required when attaching --action (the worker needs an agent to permission-check against)');
    process.exit(1);
  }

  const context = action ? { action } : null;
  const id = await memory.createMission(goal, priority, context, flags.assign || null);
  console.log(`created mission #${id}`);
}

async function cmdList(memory, argv) {
  const flags = parseFlags(argv);
  const status = typeof flags.status === 'string' ? flags.status : null;
  const limit = flags.limit !== undefined ? parseInt(flags.limit, 10) : 20;
  const missions = await memory.getMissions(status, limit);
  if (!missions.length) {
    console.log('no missions found');
    return;
  }
  missions.forEach(printMission);
}

async function cmdCancel(memory, argv) {
  const id = parseInt(argv[0], 10);
  if (!id) {
    console.error('Usage: mission-cli.js cancel <id>');
    process.exit(1);
  }
  const changes = await memory.updateMission(id, 'cancelled');
  console.log(changes ? `mission #${id} cancelled` : `mission #${id} not found`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const memory = new HeidiMemory({ dbPath: path.join(__dirname, '../heidi-core/data/heidi_memory.db') });
  await memory.initialize();

  try {
    if (cmd === 'create') await cmdCreate(memory, rest);
    else if (cmd === 'list') await cmdList(memory, rest);
    else if (cmd === 'cancel') await cmdCancel(memory, rest);
    else {
      console.error('Usage: mission-cli.js <create|list|cancel> ...');
      process.exit(1);
    }
  } finally {
    await memory.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { parseFlags, cmdCreate, cmdList, cmdCancel };
