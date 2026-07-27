'use strict';

/**
 * Phase 23B guard: every production entry point must boot through
 * `HYDIOperationalBoot.boot()` and must not construct `OperatorSession`
 * directly. Demo scripts are deliberately excluded because they are not
 * production surfaces.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

const ENTRY_POINTS = [
  { file: 'scripts/operator-cli.js', marker: 'HYDIOperationalBoot' },
  { file: 'scripts/hydi-cli.js', marker: 'HYDIOperationalBoot' },
  { file: 'src/hydi-v3/cockpitSession.js', marker: 'HYDIOperationalBoot' },
  { file: 'pages/api/cockpit/index.js', marker: 'getCockpitSession' },
  { file: 'pages/api/cockpit/command.js', marker: 'getCockpitSession' },
];

describe('production entry points do not bypass HYDIOperationalBoot', () => {
  for (const { file, marker } of ENTRY_POINTS) {
    const full = path.join(ROOT, file);

    test(`${file} uses ${marker} and does not construct OperatorSession`, () => {
      const content = fs.readFileSync(full, 'utf8');
      expect(content).toContain(marker);
      expect(content).not.toMatch(/new\s+OperatorSession/);
    });
  }
});
