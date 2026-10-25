'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

(hasPython ? describe : describe.skip)('forge-board python sdk', () => {
  it('posts as Jordan with the human token when the device has no agent token', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../board_sdk_human_fallback_test.py')], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });
});
