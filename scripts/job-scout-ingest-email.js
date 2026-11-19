#!/usr/bin/env node
'use strict';

/**
 * Stdin JSON { from, subject, body, receivedAt?, leadId? } → win or platform payment ingest.
 * Does not send mail or touch job sites.
 */

const { parseWinEmail, createProjectFromWin, breakdownTasks, parsePaymentEmail, recordPlatformPayment, workspaceDir } = require('../lib/job-scout/freelance-workspace');
const { scoutDir } = require('../lib/job-scout/decisions');

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const scout = scoutDir();
  const ws = workspaceDir();
  const win = parseWinEmail(body);
  if (win) {
    const project = createProjectFromWin(ws, scout, win, { payUsd: body.payUsd, deadline: body.deadline });
    const tasks = await breakdownTasks(project, { env: process.env });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, kind: 'win', projectId: project.id, tasks: tasks.length }, null, 2));
    return;
  }
  const pay = parsePaymentEmail(body);
  if (pay) {
    const entry = recordPlatformPayment(ws, pay);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, kind: 'payment', entry }, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: false, error: 'unrecognized_email' }, null, 2));
  process.exitCode = 2;
}

if (require.main === module) main().catch((e) => {
  console.error(e);
  process.exit(1);
});