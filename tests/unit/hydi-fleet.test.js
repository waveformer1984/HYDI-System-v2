'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

(hasPython ? describe : describe.skip)('hydi.py /api/fleet real subsystem status', () => {
  it('reports probed Frank/Ollama/Groq/llama/board state, never a fabricated mesh', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_fleet_test.py')], {
      encoding: 'utf8',
      env: { ...process.env, GROQ_API_KEY: '', FRANK_HOSTS: '', FRANK_IP: '' },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });
});
