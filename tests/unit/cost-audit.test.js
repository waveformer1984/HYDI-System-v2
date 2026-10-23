const fs = require('fs');
const os = require('os');
const path = require('path');
const { main, keyReport, callSiteReport, looksReal } = require('../../scripts/cost-audit');

function tmpRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-audit-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return root;
}

describe('cost-audit', () => {
  let log;
  beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());

  test('placeholders are not treated as real keys', () => {
    expect(looksReal('your-anthropic-key')).toBe(false);
    expect(looksReal('sk-placeholder-0000000000000000')).toBe(false);
    expect(looksReal('')).toBe(false);
    expect(looksReal('sk-ant-abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });

  test('reports keys from env and .env files, ignoring .env.example', () => {
    const root = tmpRepo({
      '.env': 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123\n',
      '.env.example': 'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz\n',
    });
    const rows = keyReport(root, { ANTHROPIC_API_KEY: 'sk-ant-abcdefghijklmnopqrstuvwxyz' });
    expect(rows).toEqual(expect.arrayContaining([
      { key: 'ANTHROPIC_API_KEY', provider: 'Anthropic', source: 'process env' },
      { key: 'OPENAI_API_KEY', provider: 'OpenAI', source: '.env' },
    ]));
    expect(rows.find(r => r.source === '.env.example')).toBeUndefined();
  });

  test('never prints key values', () => {
    const secret = 'sk-ant-SHOULDNEVERAPPEAR1234567890';
    const root = tmpRepo({});
    main([], { ANTHROPIC_API_KEY: secret }, root);
    const out = log.mock.calls.flat().join('\n');
    expect(out).toContain('ANTHROPIC_API_KEY');
    expect(out).not.toContain(secret);
  });

  test('finds paid call sites, skipping comments and tests', () => {
    const root = tmpRepo({
      'lib/a.ts': "await fetch('https://api.openai.com/v1/chat');\n// api.anthropic.com in a comment\n",
      'lib/a.test.ts': "fetch('https://api.anthropic.com/v1/messages')\n",
    });
    expect(callSiteReport(root)).toEqual([{ provider: 'OpenAI', file: path.join('lib', 'a.ts'), line: 1 }]);
  });

  test('--strict fails only when a paid key is set', () => {
    const root = tmpRepo({});
    expect(main(['--strict'], {}, root)).toBe(0);
    expect(main(['--strict'], { OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz123' }, root)).toBe(1);
    expect(main([], { OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz123' }, root)).toBe(0);
  });
});
