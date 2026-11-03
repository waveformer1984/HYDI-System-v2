'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decisionInbox, brief, missionCard, fixCard } = require('../../heidi-core/status/decision-inbox');

const mem = (missions = []) => ({
  getMissions: async (status, limit) => status ? missions.filter(m => m.status === status).slice(0, limit) : missions.slice(0, limit),
  countMissionsByStatus: async () => missions.reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a; }, {}),
});

describe('decision-inbox', () => {
  it('composes awaiting_approval missions into cards', async () => {
    const inbox = await decisionInbox(mem([{ id: 1, goal: 'restart heidi-web', status: 'awaiting_approval', context: { action: { type: 'restart_module' } }, updated_at: new Date().toISOString() }]), os.tmpdir());
    expect(inbox.counts.awaitingApproval).toBe(1);
    expect(inbox.cards[0].kind).toBe('mission');
    expect(inbox.cards[0].proposedAction).toMatch('restart_module');
    expect(inbox.cards[0].risk).toMatch('restart');
  });
  it('marks stale cards honestly', () => {
    const old = missionCard({ id: 2, goal: 'old', status: 'awaiting_approval', updated_at: '2026-01-01T00:00:00Z' });
    expect(old.stale).toBe(true);
  });
  it('includes CRIT fix-list items when the file exists', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
    fs.mkdirSync(path.join(root, '.runtime', 'fixlist'), { recursive: true });
    fs.writeFileSync(path.join(root, '.runtime', 'fixlist', 'current.json'), JSON.stringify({ items: [{ level: 'CRIT', kind: 'stray', subject: 'o', detail: 'd' }] }));
    const inbox = await decisionInbox(mem([]), root);
    expect(inbox.counts.fixListCrit).toBe(1);
    expect(inbox.cards[0].kind).toBe('fix');
  });
  it('honest empty vs unavailable — missing file is empty, failed source is unavailable', async () => {
    const empty = await decisionInbox(mem([]), os.tmpdir());
    expect(empty.empty).toBe(true);
    expect(empty.unavailable).toBe(false); // missing file is honest-empty, not a failure
    const broken = await decisionInbox({ getMissions: async () => { throw new Error('db down') } }, os.tmpdir());
    expect(broken.empty).toBe(true);
    expect(broken.sources.missions).toBe('unavailable');
    expect(broken.unavailable).toBe(true);
  });
  it('dedups a mission already represented as a fix item', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
    fs.mkdirSync(path.join(root, '.runtime', 'fixlist'), { recursive: true });
    fs.writeFileSync(path.join(root, '.runtime', 'fixlist', 'current.json'), JSON.stringify({ items: [{ level: 'CRIT', kind: 'mission', subject: '1', detail: 'd' }] }));
    const inbox = await decisionInbox(mem([{ id: 1, goal: 'g', status: 'awaiting_approval' }]), root);
    expect(inbox.cards).toHaveLength(1); // fix item covers it — no double card
  });
  it('brief composes from actual records', async () => {
    const b = await brief(mem([{ id: 1, goal: 'g', status: 'awaiting_approval' }]), os.tmpdir());
    expect(b.missionCounts.awaiting_approval).toBe(1);
    expect(b.pendingDecisions).toBeGreaterThanOrEqual(1);
  });
});
