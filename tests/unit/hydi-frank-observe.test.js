'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

(hasPython ? describe : describe.skip)('hydi.py Frank observation', () => {
  it('reads Frank\'s snapshot with the read token, shows it on the dashboard, and answers Frank questions from it', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_frank_observe_test.py')], {
      encoding: 'utf8',
      env: { ...process.env, GROQ_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9', HYDI_PHONE_READ_TOKEN: '' },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });
});
