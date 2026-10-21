'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;
const html = fs.readFileSync(path.join(__dirname, '../../hydi-mobile-protoforge.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error('unterminated ' + name);
}

(hasPython ? describe : describe.skip)('hydi.py grow commands file #ops requests only', () => {
  it('files one REQUEST per grow/agent command and leaves state alone', () => {
    const result = spawnSync(pythonBin(), [path.join(__dirname, '../hydi_no_fake_grow_test.py')], {
      encoding: 'utf8',
      env: { ...process.env, GROQ_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9' },
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'python test failed');
    }
    expect(result.stdout).toContain('ok');
  });
});

describe('phone grow buttons and stats do not claim work', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    extractFunction('growReplyText') + '\n' + extractFunction('statText'),
    sandbox,
  );

  it('reports the board id only when hydi filed it', () => {
    expect(sandbox.growReplyText({ queued: true, board_id: 'm9' }))
      .toBe('Request filed on #ops: m9. Not executed — needs a human on Frank.');
    expect(sandbox.growReplyText({ queued: false, reason: 'board unavailable' }))
      .toBe('Request was NOT filed on #ops. Nothing was executed. board unavailable');
    expect(sandbox.growReplyText({ queued: true })).toMatch(/^Request was NOT filed/);
    expect(sandbox.growReplyText(null)).toMatch(/^Request was NOT filed/);
  });

  it('shows unknown instead of a number when the source is missing', () => {
    expect(sandbox.statText(null, (v) => '$' + v)).toBe('unknown');
    expect(sandbox.statText(undefined, (v) => '$' + v)).toBe('unknown');
    expect(sandbox.statText(1200, (v) => '$' + v)).toBe('$1200');
  });

  it('no longer fakes grow progress, trends, or sparklines', () => {
    expect(html).toContain("fetch(CFG.apiBase + '/api/protoforge/grow'");
    expect(html).not.toMatch(/grow_action/);
    expect(html).not.toMatch(/Scaling agent pool|Monitoring for confirmation|Action queued/);
    expect(html).not.toMatch(/▲ growing|▲ strong/);
    expect(extractFunction('renderSparkbars')).not.toMatch(/Math\.random/);
  });
});
