'use strict';

/**
 * Regression: next dev must not pull lib/runtime/provenance.js into the
 * webpack graph for /heidi (or any page). Provenance uses fs/child_process.
 * Import trace failure: instrumentation.ts → provenance.js → "Can't resolve 'fs'".
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const INSTRUMENTATION_FILES = [
  'instrumentation.ts',
  'apps/ursula-frontend/src/instrumentation.ts',
];

describe('instrumentation provenance import boundary', () => {
  it('loads provenance only through the Node CJS bridge (not a webpack import)', () => {
    const bridge = path.join(ROOT, 'lib/runtime/next-provenance-register.cjs');
    expect(fs.existsSync(bridge)).toBe(true);
  const bridgeSrc = fs.readFileSync(bridge, 'utf8');
    expect(bridgeSrc).toMatch(/provenance\.js/);
    expect(bridgeSrc).toMatch(/createRequire/);

    for (const rel of INSTRUMENTATION_FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).toMatch(/next-provenance-register\.cjs/);
      expect(src).toMatch(/__non_webpack_require__/);
      expect(src).not.toMatch(/provenance\.js/);
      expect(src).not.toMatch(/import\([^)]*provenance/);
    }
    const nextConfig = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
    expect(nextConfig).toMatch(/instrumentation-stub\.ts/);
  });
});