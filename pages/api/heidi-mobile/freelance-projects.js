'use strict';

/**
 * Won projects, delivery drafts, platform payment ledger, weekly summary.
 * No platform API access — email-parse hooks only.
 */

const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { scoutDir } = require('../../../lib/job-scout/decisions.js');
const {
  workspaceDir,
  loadProjects,
  createProjectFromWin,
  parseWinEmail,
  breakdownTasks,
  deadlineReminders,
  markRemindersSent,
  parsePaymentEmail,
  recordPlatformPayment,
  loadPlatformLedger,
  draftDeliveryMessage,
  weeklySummary,
} = require('../../../lib/job-scout/freelance-workspace.js');

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: 'freelance-projects',
    rateMax: req.method === 'POST' ? 20 : 40,
  });
  if (!g.ok) return;

  const scoutRoot = scoutDir();
  const ws = workspaceDir();

  if (req.method === 'GET') {
    const data = loadProjects(ws);
    const reminders = [];
    for (const p of data.projects) {
      reminders.push(...deadlineReminders(p));
    }
    const summary = req.query && req.query.weekly === '1' ? weeklySummary(scoutRoot, ws) : undefined;
    return res.status(200).json({
      ok: true,
      projects: data.projects,
      reminders,
      platformLedger: loadPlatformLedger(ws),
      weekly: summary,
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = body.action;

  try {
    if (action === 'ingest_win_email') {
      const win = parseWinEmail({
        from: body.from,
        subject: body.subject,
        body: body.body,
        receivedAt: body.receivedAt,
        leadId: body.leadId,
      });
      if (!win) return res.status(422).json({ ok: false, error: 'not_a_win_email' });
      const project = createProjectFromWin(ws, scoutRoot, win, { payUsd: body.payUsd, deadline: body.deadline });
      const tasks = await breakdownTasks(project, { env: process.env });
      project.tasks = tasks;
      const { loadProjects: lp, saveProjects: sp } = require('../../../lib/job-scout/freelance-workspace.js');
      const store = lp(ws);
      const idx = store.projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) store.projects[idx] = project;
      sp(ws, store);
      return res.status(200).json({ ok: true, project, tasks });
    }

    if (action === 'ingest_payment_email') {
      const payment = parsePaymentEmail({
        from: body.from,
        subject: body.subject,
        body: body.body,
        receivedAt: body.receivedAt,
        platform: body.platform,
      });
      if (!payment) return res.status(422).json({ ok: false, error: 'not_a_payment_email' });
      const entry = recordPlatformPayment(ws, payment);
      return res.status(200).json({ ok: true, entry });
    }

    if (action === 'delivery_draft') {
      const data = loadProjects(ws);
      const p = data.projects.find((x) => x.id === body.projectId);
      if (!p) return res.status(404).json({ ok: false, error: 'not_found' });
      const message = draftDeliveryMessage(p);
      const { saveProjects } = require('../../../lib/job-scout/freelance-workspace.js');
      saveProjects(ws, data);
      return res.status(200).json({ ok: true, message, humanSendRequired: true });
    }

    if (action === 'ack_reminders') {
      markRemindersSent(ws, body.projectId, body.kinds || []);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'unknown_action' });
  } catch (e) {
    const code = e && e.code;
    if (code === 'DUPLICATE') return res.status(409).json({ ok: false, error: 'duplicate_entry' });
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
  }
}