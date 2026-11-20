'use strict';

/**
 * Memory PR1: scheduler ticks must live only under hydi-schedulers, not as
 * duplicate PM2 apps in ecosystem.config.js.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const { JOBS } = require('../../scripts/hydi-schedulers');
const ecosystem = require(path.join(ROOT, 'ecosystem.config.js'));

const SCHEDULER_OWNED_SCRIPTS = [
  'scripts/watchdog.js',
  'scripts/model-prep-executor-scheduler.js',
  'scripts/heidi-daily-loop.js',
  'scripts/protoforge-opportunity-scheduler.js',
  'scripts/stuck-job-scheduler.js',
  'scripts/revenue-reconciliation-scheduler.js',
  'scripts/failed-webhook-scheduler.js',
];

const SCHEDULER_OWNED_JOB_NAMES = [
  'hydi-watchdog',
  'hydi-model-prep-executor',
  'heidi-daily-loop',
  'hydi-protoforge-scout',
  'hydi-stuck-job-scheduler',
  'hydi-revenue-reconciliation',
  'hydi-failed-webhook-retry',
];

function repoRelativeScript(app) {
  const cwd = app.cwd ? path.resolve(ROOT, app.cwd) : ROOT;
  const abs = path.resolve(cwd, app.script);
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

function ecosystemScripts() {
  return ecosystem.apps.map((app) => ({
    name: app.name,
    script: repoRelativeScript(app),
  }));
}

describe('hydi-schedulers JOBS still covers the seven deduped ticks', () => {
  it('lists every expected job name', () => {
    const names = JOBS.map((j) => j.name);
    for (const expected of SCHEDULER_OWNED_JOB_NAMES) {
      expect(names).toContain(expected);
    }
  });

  it('points at the same script paths', () => {
    const byName = new Map(JOBS.map((j) => [j.name, j.script]));
    expect(byName.get('hydi-watchdog')).toBe('scripts/watchdog.js');
    expect(byName.get('hydi-model-prep-executor')).toBe('scripts/model-prep-executor-scheduler.js');
    expect(byName.get('heidi-daily-loop')).toBe('scripts/heidi-daily-loop.js');
    expect(byName.get('hydi-protoforge-scout')).toBe('scripts/protoforge-opportunity-scheduler.js');
    expect(byName.get('hydi-stuck-job-scheduler')).toBe('scripts/stuck-job-scheduler.js');
    expect(byName.get('hydi-revenue-reconciliation')).toBe('scripts/revenue-reconciliation-scheduler.js');
    expect(byName.get('hydi-failed-webhook-retry')).toBe('scripts/failed-webhook-scheduler.js');
  });

  it('scheduler scripts remain on disk', () => {
    for (const rel of SCHEDULER_OWNED_SCRIPTS) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });
});

describe('ecosystem has no duplicate script paths vs hydi-schedulers JOBS', () => {
  it('declares hydi-schedulers supervisor', () => {
    expect(ecosystem.apps.some((a) => a.name === 'hydi-schedulers')).toBe(true);
  });

  it('does not declare standalone PM2 apps for scheduler-owned scripts', () => {
    const jobScripts = new Set(JOBS.map((j) => j.script));
    const duplicates = ecosystemScripts().filter((app) => jobScripts.has(app.script));
    expect(duplicates).toEqual([]);
  });

  it('does not declare the removed PM2 app names', () => {
    const names = ecosystem.apps.map((a) => a.name);
    for (const removed of [
      'hydi-watchdog',
      'hydi-model-prep-executor',
      'hydi-daily-loop',
      'hydi-protoforge-scout',
      'hydi-stuck-job-scheduler',
      'hydi-revenue-reconciliation',
      'hydi-failed-webhook-retry',
    ]) {
      expect(names).not.toContain(removed);
    }
  });
});

describe('optional apps use autostart: false', () => {
  it('hydi-local-ci and proto-yi', () => {
    const localCi = ecosystem.apps.find((a) => a.name === 'hydi-local-ci');
    const protoYi = ecosystem.apps.find((a) => a.name === 'proto-yi');
    expect(localCi.autostart).toBe(false);
    expect(protoYi.autostart).toBe(false);
  });
});