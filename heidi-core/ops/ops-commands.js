'use strict';

/**
 * `ops` chat commands — deterministic like `fix list` / `task` / `trace`.
 * Answers the operator's four questions from persisted evidence:
 *   ops status          — what is wrong? (mode, pause, open incidents)
 *   ops incidents       — open + recent incidents
 *   ops incident <id>   — what has the agent done? (event history)
 *   ops pause|resume    — global action gate (observation continues)
 *   ops runbooks        — the policy table
 */

const RUNBOOK_TEXT = [
  'Runbook policy table:',
  '  observe_only   — always allowed: probes, mission reads, status files',
  '  approval       — repair proposals become missions awaiting human `task approve`',
  '  prohibited     — never: image-name kills, reboot, config/secret/env edits,',
  '                  deploys, self-permission edits, bypassing approvals',
].join('\n');

function isOpsQuery(input) {
  return /^ops(\s|$)/i.test(String(input || '').trim());
}

function parseOpsCommand(input) {
  const m = String(input || '').trim().match(/^ops\s*(\w+)?\s*(.*)$/i);
  if (!m) return null;
  return { cmd: (m[1] || 'status').toLowerCase(), arg: (m[2] || '').trim() };
}

function fmtIncident(inc) {
  const obs = parse(inc.observation);
  return `#${inc.id} ${inc.component} ${inc.kind} [${inc.state}]` +
    (inc.mission_id ? ` mission:${inc.mission_id}` : '') +
    ` opened:${inc.opened_at}` + (obs && obs.consecutiveFailures ? ` (${obs.consecutiveFailures} fails)` : '');
}

function parse(s) { try { return typeof s === 'string' ? JSON.parse(s) : s || null; } catch { return null; } }

async function runOpsCommand(agent, cmd) {
  if (!agent) return 'ops agent not running';
  switch (cmd.cmd) {
    case 'status': {
      const s = await agent.status();
      const lines = [
        `ops agent: ${s.paused ? 'PAUSED' : 'active'} (mode=${s.mode}, instance=${agent.instanceId})`,
        `watching: ${s.watching.join(', ') || 'none'}`,
        `open incidents: ${s.openIncidents}` + (s.circuitOpen ? '  CIRCUIT OPEN' : ''),
      ];
      for (const inc of s.incidents.slice(0, 10)) lines.push('  ' + fmtIncident(inc));
      return lines.join('\n');
    }
    case 'incidents': {
      const open = await agent.store.incidents(['open', 'diagnosed', 'proposed', 'repairing', 'verifying', 'escalated', 'resolved'], 20);
      if (!open.length) return 'no incidents recorded';
      return open.map(fmtIncident).join('\n');
    }
    case 'incident': {
      if (!cmd.arg) return 'usage: ops incident <id>';
      const inc = await agent.store.getIncident(cmd.arg);
      if (!inc) return `incident ${cmd.arg} not found`;
      const events = await agent.store.eventsFor(inc.id, 30);
      const lines = [fmtIncident(inc)];
      if (inc.diagnosis) { const d = parse(inc.diagnosis); lines.push(`  fact: ${d && d.fact}`, `  impact: ${d && d.impact}`); }
      if (inc.hypothesis) lines.push(`  hypothesis: ${inc.hypothesis}`);
      if (inc.authorization) { const a = parse(inc.authorization); lines.push(`  authorization: ${a && a.basis}${a && a.mission_id ? ` mission:${a.mission_id}` : ''}`); }
      for (const e of events) lines.push(`  ${e.at.slice(11, 19)} ${e.kind}: ${e.reason || ''}`);
      return lines.filter(Boolean).join('\n');
    }
    case 'pause': {
      await agent.store.setControl('paused', '1', 'operator');
      return 'ops agent PAUSED — observation continues, no new repair proposals';
    }
    case 'resume': {
      await agent.store.setControl('paused', '0', 'operator');
      return 'ops agent resumed';
    }
    case 'runbooks':
      return RUNBOOK_TEXT;
    default:
      return 'ops commands: status | incidents | incident <id> | pause | resume | runbooks';
  }
}

module.exports = { isOpsQuery, parseOpsCommand, runOpsCommand };
