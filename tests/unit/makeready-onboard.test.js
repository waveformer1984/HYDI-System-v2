'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildConfigFromAnswers,
  writeCustomerConfig,
  embedScriptSnippet,
  parsePhaseLines,
  configPath,
} = require('../../lib/makeready-bot/onboard');

describe('makeready onboard (step 4)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makeready-onboard-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rejects non-positive phase rates', () => {
    expect(parsePhaseLines(['final_clean 0']).ok).toBe(false);
    expect(parsePhaseLines(['final_clean -1']).ok).toBe(false);
  });

  test('buildConfigFromAnswers requires price_points phases', () => {
    const built = buildConfigFromAnswers('acme-clean', {
      display_name: 'Acme Clean',
      owner_email: 'owner@example.com',
      service_area: '78201 78209',
      lead_time: '3-5 days',
      insurance_statement: 'GL + WC on file',
      minimum_charge: 400,
      story_multiplier_1: 1,
      story_multiplier_2: 1.1,
      story_multiplier_3: 1.2,
      phase_lines: ['rough_clean 0.18', 'final_clean 0.32'],
    });
    expect(built.ok).toBe(true);
    expect(built.config.price_points.phases.final_clean.per_sqft).toBe(0.32);
    expect(built.config.demo).toBe(false);
  });

  test('refuses overwrite without force', () => {
    const slug = 'test-co-slug';
    const built = buildConfigFromAnswers(slug, {
      display_name: 'Test Co',
      owner_email: 'o@example.com',
      service_area: '78201',
      lead_time: 'x',
      insurance_statement: 'y',
      minimum_charge: 425,
      story_multiplier_1: 1,
      story_multiplier_2: 1.12,
      story_multiplier_3: 1.22,
      phase_lines: ['final_clean 0.3'],
    });
    expect(built.ok).toBe(true);
    writeCustomerConfig(slug, built.config, { configDir: tmpDir });
    const again = writeCustomerConfig(slug, built.config, { configDir: tmpDir });
    expect(again.ok).toBe(false);
    expect(again.error).toBe('config_exists');
  });

  test('force overwrite succeeds', () => {
    const slug = 'force-co';
    const base = {
      display_name: 'Force Co',
      owner_email: 'o@example.com',
      service_area: '78201',
      lead_time: 'x',
      insurance_statement: 'y',
      minimum_charge: 425,
      story_multiplier_1: 1,
      story_multiplier_2: 1.12,
      story_multiplier_3: 1.22,
      phase_lines: ['final_clean 0.3'],
    };
    const built = buildConfigFromAnswers(slug, base);
    writeCustomerConfig(slug, built.config, { configDir: tmpDir });
    const built2 = buildConfigFromAnswers(slug, { ...base, minimum_charge: 500 });
    const forced = writeCustomerConfig(slug, built2.config, { force: true, configDir: tmpDir });
    expect(forced.ok).toBe(true);
    const saved = JSON.parse(fs.readFileSync(configPath(slug, tmpDir), 'utf8'));
    expect(saved.price_points.minimum_charge).toBe(500);
  });

  test('embed snippet uses public widget path', () => {
    const snip = embedScriptSnippet('my-slug', 'https://example.test');
    expect(snip).toMatch(/\/makeready-bot\/widget\.js/);
    expect(snip).toMatch(/data-slug="my-slug"/);
    expect(snip).not.toMatch(/\/public\//);
  });
});