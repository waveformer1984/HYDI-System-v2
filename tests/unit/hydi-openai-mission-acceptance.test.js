'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_DOCS = [
  'HYDI_OPENAI_MISSION_CONTROL.md',
  'OPENAI_RESOURCE_OPPORTUNITIES.md',
  'OPENAI_PARTNERSHIP_APPLICATIONS.md',
  'HYDI_MASTER_ARCHITECTURE_AUDIT.md',
  'HYDI_CODEX_INTEGRATION.md',
  'HYDI_MULTI_AGENT_WORKFORCE.md',
  'HYDI_OPENAI_PROVIDER_INTEGRATION.md',
  'HYDI_OPENAI_DEMO.md',
  'HYDI_AGENT_SECURITY_GOVERNANCE.md',
  'HYDI_ZERO_COST_INFRASTRUCTURE_EXPANSION.md',
  'HYDI_REVENUE_AGENT_ARCHITECTURE.md',
];

describe('HYDI OpenAI master mission deliverables', () => {
  const root = path.join(__dirname, '..', '..', 'docs');

  test.each(REQUIRED_DOCS)('doc exists: %s', (name) => {
    expect(fs.existsSync(path.join(root, name))).toBe(true);
  });

  test('openai adapter module exists', () => {
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'lib/providers/openai-adapter.js'))).toBe(true);
  });

  test('dev workforce coordinator exists', () => {
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'lib/dev-workforce/coordinator.js'))).toBe(true);
  });
});