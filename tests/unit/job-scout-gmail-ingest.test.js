'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const samples = require('../fixtures/job-scout/gmail-samples.json');
const {
  classifyInbound,
  leadFromJobEmail,
  processInboundMessages,
  runGmailIngest,
} = require('../../lib/job-scout/gmail-ingest');
const { loadProjects, loadPlatformLedger, workspaceDir } = require('../../lib/job-scout/freelance-workspace');

describe('job scout Gmail ingest (fixtures)', () => {
  const cases = samples.messages;

  test.each(cases)('classifies $id as $expectType', ({ id, expectType, ...msg }) => {
    expect(classifyInbound(msg).type).toBe(expectType);
  });

  test('unparsed job alert keeps lead with parse_failed', () => {
    const bad = cases.find((m) => m.expectParseFailed);
    const lead = leadFromJobEmail(bad);
    expect(lead.parse_failed).toBe(true);
    expect(lead.id).toBe(`gmail:${bad.id}`);
  });

  test('process fixtures: jobs, wins, payments, ignored counts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-scout-'));
    const env = { JOB_SCOUT_DIR: dir };
    const jobMsgs = cases.filter((m) => m.expectType === 'job');
    const result = await processInboundMessages(cases, { env, dir });
    expect(result.leads.length).toBe(jobMsgs.length);
    expect(result.summary.jobs).toBe(jobMsgs.length);
    expect(result.summary.parse_failed).toBe(1);
    expect(result.summary.ignored).toBeGreaterThanOrEqual(1);
    expect(result.summary.wins).toBe(3);
    expect(result.summary.payments).toBe(2);
    const ws = workspaceDir(env);
    expect(loadProjects(ws).projects.length).toBe(3);
    expect(loadPlatformLedger(ws).entries.length).toBe(2);
  });

  test('dedupe by Gmail message id on second pass', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-dedupe-'));
    const first = await processInboundMessages(cases.slice(0, 2), { dir });
    expect(first.summary.skippedDuplicate).toBe(0);
    const second = await processInboundMessages(cases.slice(0, 2), { dir });
    expect(second.summary.skippedDuplicate).toBe(2);
    expect(second.leads.length).toBe(0);
  });

  test('runGmailIngest skips without token (fail closed)', async () => {
    const out = await runGmailIngest({ env: { JOB_SCOUT_GMAIL: '1' }, fixtureMessages: null });
    expect(out.skipped).toBe(true);
    expect(out.reason).toMatch(/token|oauth|googleapis/);
  });

  test('fixture mode does not call Gmail API', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmail-fix-'));
    const job = cases.find((m) => m.expectType === 'job' && !m.expectParseFailed);
    const out = await runGmailIngest({
      env: { JOB_SCOUT_DIR: dir },
      fixtureMessages: [job],
    });
    expect(out.ok).toBe(true);
    expect(out.leads[0].sourceUrl).toContain('freelancer.com');
  });
});