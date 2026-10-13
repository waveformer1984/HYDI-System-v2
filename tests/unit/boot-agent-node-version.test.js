'use strict';

// Boot preflight must refuse Node < 22. package.json engines require >=22
// (#333) because @supabase/supabase-js needs Node 22's native WebSocket; on
// Node 20 the daemon catches the client crash (#332) and would run with its
// Supabase bridges silently unwired. Requiring boot-agent is safe: its
// entry point is guarded by `require.main === module`.
const { nodeVersionSupported, MIN_NODE_MAJOR } = require('../../scripts/boot-agent');
const pkg = require('../../package.json');

describe('boot-agent preflight: Node version gate', () => {
  test('minimum major matches package.json engines', () => {
    const enginesMajor = parseInt(String(pkg.engines.node).replace(/[^0-9.]/g, '').split('.')[0], 10);
    expect(MIN_NODE_MAJOR).toBe(enginesMajor);
  });

  test.each(['22.0.0', '22.22.0', 'v22.1.0', '24.3.1'])('accepts %s', (v) => {
    expect(nodeVersionSupported(v)).toBe(true);
  });

  test.each(['20.19.0', 'v20.0.0', '21.7.3', '18.20.4'])('blocks %s', (v) => {
    expect(nodeVersionSupported(v)).toBe(false);
  });

  test.each(['', 'garbage', undefined])('fails closed on unparseable version %p', (v) => {
    expect(nodeVersionSupported(v)).toBe(false);
  });

  test('the running Node passes (CI and Frank run >=22)', () => {
    expect(nodeVersionSupported(process.versions.node)).toBe(true);
  });
});
