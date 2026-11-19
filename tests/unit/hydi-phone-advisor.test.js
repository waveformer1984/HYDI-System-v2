'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

(hasPython ? describe : describe.skip)('hydi.py / heidi.py phone advisor', () => {
  it('advise_proposal uses Frank Ollama then llama.cpp fallback', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_phone_advisor_test.py')], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });

  it('heidi.py advise CLI emits JSON verdict', () => {
    const result = spawnSync(
      pythonBin(),
      [path.join(__dirname, '../../heidi.py'), 'advise', 'test proposal'],
      {
        encoding: 'utf8',
        env: { ...process.env, FRANK_IP: '', FRANK_HOSTS: '' },
      }
    );
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout.trim());
    expect(['AUTO-APPROVE', 'REVIEW', 'BLOCK']).toContain(body.verdict);
    expect(body.executed).toBe(false);
  });
});