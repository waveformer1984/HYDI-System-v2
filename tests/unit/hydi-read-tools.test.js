'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

(hasPython ? describe : describe.skip)('hydi.py read-only tools', () => {
  it('answers status/board/revenue/PR asks from tools and flags unsupported $ figures', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_read_tools_test.py')], {
      encoding: 'utf8',
      env: { ...process.env, GROQ_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9' },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });
});
