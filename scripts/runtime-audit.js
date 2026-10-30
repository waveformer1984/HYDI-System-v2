'use strict';

/**
 * Report which code long-running processes are actually running.
 * Prints a table and exits non-zero on any verdict other than OK.
 * Never restarts, kills, or starts a process — suggestions are text.
 *
 * HYDI_RUNTIME_AUDIT_FIXTURE (tests only) is a JSON file of auditDrift
 * inputs. When it is set, pm2 and git are not invoked.
 */

const fs = require('fs');
const { auditDrift } = require('../lib/runtime/drift-audit');
const { collectRuntimeAudit } = require('../lib/runtime/collect');

function formatAudit(audit) {
  const lines = [];
  lines.push(`overall\t${audit.overall}`);
  if (audit.repoHead) lines.push(`repoHead\t${audit.repoHead}`);
  if (audit.suggestion) lines.push(audit.suggestion);
  const counts = audit.counts || {};
  lines.push(`counts\t${Object.keys(counts).map((key) => `${key}=${counts[key]}`).join(' ')}`);
  lines.push('name\tverdict\tgitSha\tdiffs\tsuggestion');
  for (const row of audit.rows || []) {
    lines.push([
      row.name,
      row.verdict,
      row.gitSha || '',
      (row.configDiffs || []).join(','),
      row.suggestion || '',
    ].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

function exitCodeFor(audit) {
  return audit && audit.overall === 'OK' ? 0 : 1;
}

async function loadAudit() {
  const fixture = process.env.HYDI_RUNTIME_AUDIT_FIXTURE;
  if (fixture) {
    try {
      return auditDrift(JSON.parse(fs.readFileSync(fixture, 'utf8')));
    } catch (_) {
      return auditDrift({ pm2Readable: false });
    }
  }
  // A person is waiting at a terminal: wait for the full PM2 read instead
  // of the 20s an HTTP health probe allows (pm2 jlist took ~28s on Frank).
  const waitMs = Number(process.env.HYDI_PM2_JLIST_TIMEOUT_MS) > 0 ? Number(process.env.HYDI_PM2_JLIST_TIMEOUT_MS) : 60000;
  return collectRuntimeAudit({ root: process.cwd(), waitMs });
}

async function main() {
  const audit = await loadAudit();
  process.stdout.write(formatAudit(audit));
  return exitCodeFor(audit);
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((e) => {
      process.stderr.write(`${e instanceof Error ? e.message : 'runtime audit failed'}\n`);
      process.exit(1);
    });
}

module.exports = { formatAudit, exitCodeFor, main, loadAudit };
