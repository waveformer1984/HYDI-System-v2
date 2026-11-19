'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

(hasPython ? describe : describe.skip)('hydi.py heidi-agent Phase 2 fleet card', () => {
  it('reads heidiAgentLoop from Frank observe (exec off, lease, cycles)', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_heidi_agent_phase2_test.py')], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });
});