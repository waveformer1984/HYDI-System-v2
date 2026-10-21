'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;
const html = fs.readFileSync(path.join(__dirname, '../../hydi-mobile-protoforge.html'), 'utf8');

(hasPython ? describe : describe.skip)('hydi.py does not claim actions it did not take', () => {
  it('guards the phone transcript replies and posts do-requests as data only', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_honest_chat_test.py')], {
      encoding: 'utf8',
      env: { ...process.env, GROQ_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9' },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });

  it('labels autonomy as display only and does not send it to a server', () => {
    const label = '(display only — no executor connected)';
    expect(html).toContain('Autonomy Level ' + label);
    expect(html).toContain('Autonomy ' + label);
    expect(html).not.toMatch(/set_autonomy/);
    expect(html).not.toMatch(/I'll operate/);
    expect(html).toContain('Recorded on phone only — nothing executes from here.');
    expect(html).not.toMatch(/\$\{cap\(decision\)\}d/);
  });
});
