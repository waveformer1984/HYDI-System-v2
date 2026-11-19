'use strict';

/**
 * Win detection → project workspace → delivery + platform payments (no auto-submit).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scoutDir, readDecisions, setDecision } = require('./decisions');
const { findLead } = require('./apply-flow');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function workspaceDir(env = process.env) {
  return path.join(scoutDir(env), 'workspace');
}

function projectsFile(dir) {
  return path.join(dir, 'projects.json');
}

function platformLedgerFile(dir) {
  return path.join(dir, 'platform-ledger.json');
}

function loadProjects(dir = workspaceDir()) {
  return readJson(projectsFile(dir), { projects: [], updatedAt: null });
}

function saveProjects(dir, data) {
  data.updatedAt = new Date().toISOString();
  writeJsonAtomic(projectsFile(dir), data);
}

function loadPlatformLedger(dir = workspaceDir()) {
  return readJson(platformLedgerFile(dir), {
    clearedPlatformUsd: 0,
    pendingPlatformUsd: 0,
    entries: [],
    reserveEligibleUsd: 0,
  });
}

function savePlatformLedger(dir, ledger) {
  writeJsonAtomic(platformLedgerFile(dir), ledger);
}

const WIN_PATTERNS = [
  { platform: 'fiverr', re: /(order (has )?started|you were hired|buyer (has )?placed an order)/i },
  { platform: 'upwork', re: /(offer (has been )?accepted|contract (has )?started|you.?ve been hired)/i },
  { platform: 'freelancer', re: /(you (have )?been awarded|you.?ve been awarded|project (has been )?awarded|hired for the project)/i },
];

function detectPlatform(from, subject, body) {
  const blob = `${from || ''} ${subject || ''} ${body || ''}`.toLowerCase();
  if (blob.includes('fiverr')) return 'fiverr';
  if (blob.includes('upwork')) return 'upwork';
  if (blob.includes('freelancer')) return 'freelancer';
  return null;
}

function parseWinEmail({ from = '', subject = '', body = '', receivedAt, leadId }) {
  const platform = detectPlatform(from, subject, body);
  const text = `${subject}\n${body}`;
  const matched = WIN_PATTERNS.find((p) => (!platform || p.platform === platform) && p.re.test(text));
  if (!matched) return null;
  return {
    platform: platform || matched.platform,
    leadId: leadId || null,
    title: subject.slice(0, 200),
    receivedAt: receivedAt || new Date().toISOString(),
    source: 'email',
  };
}

function projectId(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function createProjectFromWin(dir, scoutRoot, win, opts = {}) {
  const data = loadProjects(dir);
  const lead = win.leadId ? findLead(scoutRoot, win.leadId) : null;
  const id = projectId(`${win.platform}|${win.title}|${win.receivedAt}`);
  if (data.projects.some((p) => p.id === id)) return data.projects.find((p) => p.id === id);
  const deadline = opts.deadline || new Date(Date.now() + 7 * 86400000).toISOString();
  const project = {
    id,
    leadId: win.leadId || lead?.id || null,
    platform: win.platform,
    title: lead?.title || win.title,
    scope: lead?.description ? String(lead.description).slice(0, 2000) : win.title,
    platformLink: lead?.sourceUrl || null,
    payUsd: opts.payUsd ?? null,
    status: 'WON',
    wonAt: win.receivedAt,
    deadline,
    delivery: { checklist: defaultChecklist(), messageDraft: null, sentAt: null },
    tasks: [],
    reminders: { halfSent: false, ninetySent: false },
  };
  if (win.leadId) {
    try { setDecision(win.leadId, 'applied', scoutRoot); } catch { /* ignore */ }
  }
  data.projects.push(project);
  saveProjects(dir, data);
  return project;
}

function defaultChecklist() {
  return [
    { id: 'scope', label: 'Deliverable matches agreed scope', done: false },
    { id: 'test', label: 'Tested on target environment', done: false },
    { id: 'docs', label: 'Handoff notes included', done: false },
    { id: 'platform', label: 'Delivery only on platform (no off-platform links)', done: false },
  ];
}

const CODING_KW = /\b(react|next\.?js|node|typescript|api|supabase|stripe|python|script)\b/i;

async function breakdownTasks(project, opts = {}) {
  const env = opts.env || process.env;
  const tasks = [];
  const scope = String(project.scope || project.title || '');
  const parts = scope.split(/[.!?]\s+/).filter(Boolean).slice(0, 8);
  const base = parts.length ? parts : [scope.slice(0, 120) || 'Review scope and plan milestones'];

  for (let i = 0; i < Math.min(base.length, 10); i += 1) {
    const summary = base[i].slice(0, 160);
    const coding = CODING_KW.test(summary);
    tasks.push({
      id: `t${i + 1}`,
      title: summary,
      kind: coding ? 'coding' : 'writing',
      status: 'pending',
      sppPrompt: coding
        ? `SPP — implement\nDU: ${summary}\nTI: code_patch\nEK: ${summary}\nNE: no platform submit; Jordan reviews before delivery`
        : null,
      draft: coding ? null : `Draft for: ${summary}`,
    });
  }

  if (env.JOB_SCOUT_LLM_DRAFTS === 'true' && opts.fetchImpl) {
    // Optional local model refinement — failures keep template tasks.
    try {
      const { llmDraft } = require('./draft');
      const text = await llmDraft(
        { title: project.title, description: scope, matched: [] },
        { pitch: 'freelance delivery' },
        { env, fetchImpl: opts.fetchImpl, timeoutMs: 15000 },
      );
      if (text && tasks[0]) tasks[0].draft = text.slice(0, 1500);
    } catch { /* keep */ }
  }

  project.tasks = tasks;
  return tasks;
}

function deadlineReminders(project, now = Date.now()) {
  if (!project.deadline || project.status === 'DELIVERED') return [];
  const start = Date.parse(project.wonAt || project.deadline);
  const end = Date.parse(project.deadline);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const elapsed = (now - start) / (end - start);
  const out = [];
  if (elapsed >= 0.5 && !project.reminders.halfSent) {
    out.push({ projectId: project.id, kind: 'deadline_50', message: `50% of time elapsed on “${project.title}”.` });
  }
  if (elapsed >= 0.9 && !project.reminders.ninetySent) {
    out.push({ projectId: project.id, kind: 'deadline_90', message: `90% of time elapsed on “${project.title}”.` });
  }
  return out;
}

function markRemindersSent(dir, projectId, kinds) {
  const data = loadProjects(dir);
  const p = data.projects.find((x) => x.id === projectId);
  if (!p) return null;
  if (kinds.includes('deadline_50')) p.reminders.halfSent = true;
  if (kinds.includes('deadline_90')) p.reminders.ninetySent = true;
  saveProjects(dir, data);
  return p;
}

function parsePaymentEmail({ from = '', subject = '', body = '', receivedAt, platform }) {
  const text = `${subject}\n${body}`;
  const plat = platform || detectPlatform(from, subject, body);
  if (!plat) return null;
  const cleared = /(funds (are )?available|payment (has )?cleared|cleared to your account|available for withdrawal)/i.test(text);
  const pending = /(payment (has been )?received|order completed|milestone submitted)/i.test(text);
  if (!cleared && !pending) return null;
  const m = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  const amountUsd = m ? Number(m[1].replace(/,/g, '')) : null;
  return {
    platform: plat,
    amountUsd,
    cleared,
    pending: !cleared && pending,
    receivedAt: receivedAt || new Date().toISOString(),
    emailId: projectId(`${plat}|${subject}|${receivedAt || ''}`),
  };
}

function recordPlatformPayment(dir, payment) {
  if (!payment || !payment.platform) throw Object.assign(new Error('invalid_payment'), { code: 'INVALID' });
  const ledger = loadPlatformLedger(dir);
  if (ledger.entries.some((e) => e.emailId === payment.emailId)) {
    throw Object.assign(new Error('duplicate'), { code: 'DUPLICATE' });
  }
  const verified = Boolean(payment.verified);
  const entry = {
    type: 'platform_payment',
    platform: payment.platform,
    amountUsd: payment.amountUsd,
    cleared: Boolean(payment.cleared),
    pending: Boolean(payment.pending),
    verified,
    emailId: payment.emailId,
    at: payment.receivedAt,
    countsTowardReserve: Boolean(payment.cleared && verified),
  };
  ledger.entries.push(entry);
  if (entry.cleared && entry.amountUsd) {
    if (verified) {
      ledger.clearedPlatformUsd += entry.amountUsd;
      ledger.reserveEligibleUsd += entry.amountUsd;
    } else {
      ledger.unverifiedClearedUsd = (ledger.unverifiedClearedUsd || 0) + entry.amountUsd;
    }
  } else if (entry.amountUsd) {
    ledger.pendingPlatformUsd += entry.amountUsd;
  }
  savePlatformLedger(dir, ledger);
  return entry;
}

function draftDeliveryMessage(project) {
  const lines = [
    `Hi — delivery for “${project.title}”.`,
    '',
    'Attached/delivered as agreed on the platform:',
    ...project.delivery.checklist.map((c) => `• ${c.label}${c.done ? ' ✓' : ''}`),
    '',
    'Please confirm receipt on-platform. Thanks,',
    '— Jordan',
  ];
  project.delivery.messageDraft = lines.join('\n');
  return project.delivery.messageDraft;
}

function weeklySummary(scoutRoot, workspace) {
  const decisions = readDecisions(scoutRoot);
  const values = Object.values(decisions);
  const applied = values.filter((d) => d.status === 'applied').length;
  const drafted = values.filter((d) => d.status === 'drafted').length;
  const skipped = values.filter((d) => d.status === 'skipped' || d.status === 'dismissed').length;
  const projects = loadProjects(workspace);
  const won = projects.projects.filter((p) => p.status === 'WON' || p.status === 'DELIVERED').length;
  const ledger = loadPlatformLedger(workspace);
  return {
    generatedAt: new Date().toISOString(),
    applied,
    drafted,
    skipped,
    won,
    earnedClearedUsd: ledger.reserveEligibleUsd,
    pendingUsd: ledger.pendingPlatformUsd,
    hoursEstimated: null,
    usdPerHour: null,
    scoringHint: 'Increase weight on job types with higher earned/applied ratio when reserve grows.',
  };
}

module.exports = {
  workspaceDir,
  parseWinEmail,
  createProjectFromWin,
  loadProjects,
  breakdownTasks,
  deadlineReminders,
  markRemindersSent,
  parsePaymentEmail,
  recordPlatformPayment,
  loadPlatformLedger,
  draftDeliveryMessage,
  weeklySummary,
};