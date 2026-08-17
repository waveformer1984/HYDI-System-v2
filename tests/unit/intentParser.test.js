'use strict';

const { parseIntent } = require('../../lib/voice/intentParser');

describe('parseIntent', () => {
  it('rejects a transcript with no wake word', () => {
    const result = parseIntent('status report please');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/wake word/);
  });

  it('rejects an empty or non-string transcript', () => {
    expect(parseIntent('').valid).toBe(false);
    expect(parseIntent(null).valid).toBe(false);
    expect(parseIntent(undefined).valid).toBe(false);
  });

  it('rejects a wake-word-only transcript with no recognized command', () => {
    const result = parseIntent('HYDI do something weird');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unrecognized command');
  });

  it.each([
    ['HYDI status report', 'status_report', 'status:view', false],
    ['Hey HYDI, check workers', 'check_workers', 'worker:view', false],
    ['HYDI summarize activity', 'summarize_activity', 'status:view', false],
    ['HYDI prepare report', 'prepare_report', 'status:view', 'action'],
  ])('recognizes "%s" as %s', (transcript, expectedIntent, expectedPermission, expectedQueues) => {
    const result = parseIntent(transcript);
    expect(result.valid).toBe(true);
    expect(result.intent).toBe(expectedIntent);
    expect(result.permission).toBe(expectedPermission);
    expect(result.queues).toBe(expectedQueues);
  });

  it('recognizes "HYDI restart service X" as a worker:control restart command with a target', () => {
    const result = parseIntent('HYDI restart service decision_assist');
    expect(result.valid).toBe(true);
    expect(result.intent).toBe('restart_service');
    expect(result.permission).toBe('worker:control');
    expect(result.queues).toBe('command');
    expect(result.command).toBe('restart');
    expect(result.target).toBe('decision_assist');
  });

  it('recognizes "HYDI start Rezonette" as a worker:control start command', () => {
    const result = parseIntent('HYDI start Rezonette');
    expect(result.valid).toBe(true);
    expect(result.intent).toBe('start_worker');
    expect(result.command).toBe('start');
    expect(result.target).toBe('Rezonette');
  });
});
