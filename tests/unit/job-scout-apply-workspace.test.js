'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  prepareApply,
  confirmSent,
  pickDigestLeads,
} = require('../../lib/job-scout/apply-flow');
const { setDecision, readDecisions } = require('../../lib/job-scout/decisions');
const {
  parseWinEmail,
  createProjectFromWin,
  breakdownTasks,
  parsePaymentEmail,
  recordPlatformPayment,
  loadPlatformLedger,
  weeklySummary,
  workspaceDir,
} = require('../../lib/job-scout/freelance-workspace');

function seed(dir, lead) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'leads.json'),
    JSON.stringify({ leads: [lead] }),
  );
  fs.writeFileSync(path.join(dir, 'decisions.json'), '{}');
}

describe('job scout apply + workspace', () => {
  const lead = {
    id: 'freelancer:99',
    title: 'Next.js fix',
    source: 'freelancer',
    sourceUrl: 'https://www.freelancer.com/projects/example',
    description: 'Need React API work',
    score: 88,
    matched: ['React.js'],
    reasons: ['skill match'],
    division: 'AppForge',
    budget: { min: 200, max: 400, currency: 'USD', type: 'fixed' },
    draft: 'Hello draft',
  };

  test('prepare_apply sets drafted; confirm_sent sets applied', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-apply-'));
    seed(dir, lead);
    const prep = prepareApply(dir, lead.id);
    expect(prep.proposal).toBe('Hello draft');
    expect(readDecisions(dir)[lead.id].status).toBe('drafted');
    const dec = confirmSent(dir, lead.id);
    expect(dec.status).toBe('applied');
    expect(() => confirmSent(dir, lead.id)).toThrow(/drafted/);
  });

  test('digest excludes skipped leads', () => {
    const decisions = { 'freelancer:1': { status: 'skipped', at: new Date().toISOString() } };
    const leads = [
      { id: 'freelancer:1', score: 99, title: 'a' },
      { id: 'freelancer:2', score: 50, title: 'b' },
    ];
    const digest = pickDigestLeads(leads, decisions, 5);
    expect(digest.map((d) => d.id)).toEqual(['freelancer:2']);
  });

  test('win email creates project with tasks', async () => {
    const scout = fs.mkdtempSync(path.join(os.tmpdir(), 'js-win-'));
    seed(scout, lead);
    setDecision(lead.id, 'drafted', scout);
    const win = parseWinEmail({
      from: 'noreply@freelancer.com',
      subject: 'You have been awarded the project',
      body: 'Congratulations',
      leadId: lead.id,
    });
    expect(win.platform).toBe('freelancer');
    const ws = path.join(scout, 'workspace');
    const project = createProjectFromWin(ws, scout, win);
    expect(project.status).toBe('WON');
    const tasks = await breakdownTasks(project);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.kind === 'coding' && t.sppPrompt)).toBe(true);
  });

  test('platform payment cleared counts toward reserve ledger', () => {
    const scout = fs.mkdtempSync(path.join(os.tmpdir(), 'js-pay-'));
    const ws = workspaceDir({ JOB_SCOUT_DIR: scout });
    const pay = parsePaymentEmail({
      from: 'payments@upwork.com',
      subject: 'Funds are available',
      body: 'Your payment of $250.00 is cleared to your account.',
    });
    expect(pay.cleared).toBe(true);
    expect(pay.amountUsd).toBe(250);
    recordPlatformPayment(ws, pay);
    const ledger = loadPlatformLedger(ws);
    expect(ledger.reserveEligibleUsd).toBe(250);
    expect(() => recordPlatformPayment(ws, pay)).toThrow(/duplicate/);
  });

  test('weekly summary includes applied count', () => {
    const scout = fs.mkdtempSync(path.join(os.tmpdir(), 'js-sum-'));
    setDecision('freelancer:1', 'applied', scout);
    setDecision('freelancer:2', 'drafted', scout);
    const ws = workspaceDir({ JOB_SCOUT_DIR: scout });
    const s = weeklySummary(scout, ws);
    expect(s.applied).toBe(1);
    expect(s.drafted).toBe(1);
  });
});