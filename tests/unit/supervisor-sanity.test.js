const { execSync } = require('child_process');
const path = require('path');

const SUPERVISOR = path.join(__dirname, '..', '..', 'supervisor.js');
const CWD = path.dirname(SUPERVISOR);

describe('supervisor.js reliability baseline', () => {
  test('supervisor dry-run loads the manifest and plans startup', () => {
    const output = execSync('node supervisor.js --dry-run', {
      cwd: CWD,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });

    expect(output).toContain('=== DRY RUN ===');
    expect(output).toContain('memory-engine');
    expect(output).toContain('hydi-core');
    expect(output).toContain('heidi-bridge');
    expect(output).toContain('next-app');
    expect(output).toContain('heidi-mobile');
    expect(output).toContain('docker-stack');
    expect(output).toContain('forge-loop');
  });

  test('supervisor.js has no syntax errors', () => {
    // node --check only parses, it does not execute top-level startup code.
    execSync(`node --check "${SUPERVISOR}"`, {
      cwd: CWD,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
  });
});
