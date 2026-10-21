'use strict';

/**
 * Board-only delegation for revenue and infrastructure reviews.
 *
 * Specialists collect evidence and return proposals. They cannot approve or
 * execute anything. Heidi opens and closes every thread; Jordan must file any
 * resulting action through Heidi's existing execution-fabric approval path.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DOMAIN_AGENTS = Object.freeze({
  revenue: { sender: 'ProtoForge', title: 'Revenue' },
  infrastructure: { sender: 'hydi-daemon', title: 'Infrastructure' },
});

function normalizeDomains(domains) {
  return [...new Set((domains || []).filter((domain) => DOMAIN_AGENTS[domain]))];
}

function execText(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1024 * 1024, ...opts }, (error, stdout) => {
      resolve(error ? '' : String(stdout || '').trim());
    });
  });
}

function pm2Command(platform = process.platform) {
  return platform === 'win32'
    ? { file: 'cmd.exe', args: ['/c', 'pm2', 'jlist'] }
    : { file: 'pm2', args: ['jlist'] };
}

async function collectInfrastructure({ repoRoot, platform = process.platform } = {}) {
  const root = repoRoot || path.resolve(__dirname, '..', '..');
  const { runHealthCheck } = require('../mobile-ops/action-runners');
  const health = await runHealthCheck({});
  const cmd = pm2Command(platform);
  const raw = await execText(cmd.file, cmd.args, { cwd: root, timeout: 20_000 });
  let apps = [];
  try { apps = JSON.parse(raw); } catch { apps = []; }
  const online = apps.filter((app) => app && app.pm2_env && app.pm2_env.status === 'online').length;
  let disk = 'disk unavailable';
  try {
    const stat = await fs.promises.statfs(root);
    disk = `${((stat.bavail * stat.bsize) / 1024 ** 3).toFixed(1)} GB free`;
  } catch { /* evidence unavailable */ }
  const probes = (health.probes || []).map((probe) => `${probe.name}:${probe.ok ? 'up' : 'down'}`).join(', ');
  return {
    evidence: [
      `PM2: ${apps.length ? `${online}/${apps.length} online` : 'unreadable'}`,
      `Health: ${health.ok ? 'all probes up' : 'degraded'}${probes ? ` (${probes})` : ''}`,
      `Disk: ${disk}`,
    ],
    proposals: health.ok && online === apps.length
      ? ['Keep monitoring; no infrastructure change is supported by this snapshot.']
      : ['Jordan should review the degraded evidence before approving any restart or repair.'],
  };
}

async function collectRevenue({ now = () => new Date() } = {}) {
  const { liveRevenueSummary } = require('../billing/live-summary');
  const { getBillingService } = require('../billing/http');
  try {
    const summary = await liveRevenueSummary(getBillingService().store, { now });
    const totals = Object.entries(summary.totals || {}).map(([currency, total]) =>
      `${currency.toUpperCase()} net ${(total.net_cents / 100).toFixed(2)} (${total.events} events)`);
    return {
      evidence: [
        'Source: processed livemode billing webhook events only; no Stripe API call.',
        ...(totals.length ? totals : ['No processed livemode payment events recorded.']),
        `Last live event: ${summary.last_live_event_at || 'none'}`,
      ],
      proposals: totals.length
        ? ['Review the verified live totals and delivery obligations; no spend, outreach, or payment was initiated.']
        : ['Verify live billing readiness before proposing outreach or go-live work.'],
    };
  } catch {
    return {
      evidence: ['Livemode revenue store unavailable; no revenue amount is claimed.'],
      proposals: ['Restore read-only revenue visibility before proposing revenue actions.'],
    };
  }
}

async function postAs(board, sender, channel, body, replyTo) {
  process.env.HYDI_BOARD_SENDER = sender;
  return board.post(channel, body.slice(0, 3900), replyTo);
}

async function runBoardDelegation({
  domains,
  board = require('../forge-board/sdk'),
  channel = 'ops',
  collectors = {},
  now = () => new Date(),
  repoRoot,
  platform,
} = {}) {
  const selected = normalizeDomains(domains);
  if (!selected.length) return { ok: false, error: 'no supported delegation domain' };

  const openedAt = now().toISOString();
  const rootBody = [
    `HEIDI DELEGATION ${openedAt} — ${selected.join(' + ')} evidence and proposal review.`,
    'Agents may inspect and propose only. They cannot approve or execute. Heidi remains the coordinator.',
  ].join('\n');
  const root = await postAs(board, 'Heidi', channel, rootBody);
  const threadId = root && root.message && root.message.id;
  if (!threadId) return { ok: false, error: (root && root.error) || 'board returned no thread id' };

  const reports = [];
  for (const domain of selected) {
    const spec = DOMAIN_AGENTS[domain];
    const collect = collectors[domain] ||
      (domain === 'revenue'
        ? () => collectRevenue({ now })
        : () => collectInfrastructure({ repoRoot, platform }));
    let report;
    try {
      report = await collect();
    } catch {
      report = { evidence: ['Collector failed; no result is claimed.'], proposals: ['Jordan should review the collector failure.'] };
    }
    const body = [
      `@Heidi ${spec.title} delegated report — PROPOSAL ONLY`,
      'Evidence:',
      ...(report.evidence || []).map((item) => `• ${item}`),
      'Proposals:',
      ...(report.proposals || []).map((item) => `→ ${item}`),
      'No approval or execution occurred.',
    ].join('\n');
    const posted = await postAs(board, spec.sender, channel, body, threadId);
    const postedOk = Boolean(posted && posted.ok !== false && posted.message && posted.message.id);
    reports.push({ domain, posted: postedOk, ...report });
  }

  const received = reports.filter((report) => report.posted).length;
  const summary = [
    `Heidi synthesis — received ${received}/${selected.length} delegated reports on the board.`,
    ...reports.filter((report) => !report.posted)
      .map((report) => `• [${report.domain}] report could not be posted; no result is claimed for that agent.`),
    ...reports.flatMap((report) => (report.proposals || []).map((item) => `• [${report.domain}] ${item}`)),
    'Hydi remains in the loop through this thread. No action was approved or executed.',
    'Jordan must file any resulting action as a separate REQUEST @Heidi and approve it through the execution fabric.',
  ].join('\n');
  await postAs(board, 'Heidi', channel, summary, threadId);
  return { ok: true, thread_id: threadId, domains: selected, reports };
}

module.exports = {
  DOMAIN_AGENTS,
  normalizeDomains,
  pm2Command,
  collectInfrastructure,
  collectRevenue,
  runBoardDelegation,
};
