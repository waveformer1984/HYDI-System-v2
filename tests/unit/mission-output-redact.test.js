'use strict';

const { redactOutput, verify } = require('../../heidi-core/missions/lifecycle.js');

describe('redactOutput (#507)', () => {
  it('keeps the tail when output exceeds the cap and marks elision', () => {
    const head = Array.from({ length: 200 }, (_, i) => `noise line ${i}`).join('\n');
    const tailLine = 'Tests: 1 failed, 44 passed, 45 total';
    const raw = `${head}\n${tailLine}`;
    const out = redactOutput(raw, 1500);
    expect(out).toContain('… (earlier chars elided)');
    expect(out).toContain(tailLine);
    expect(out).not.toContain(head.slice(0, 80));
  });

  it('returns short output whole', () => {
    const raw = 'hello\nworld';
    expect(redactOutput(raw, 1500)).toBe(raw);
  });

  it('redacts secret-looking content that falls inside the kept tail', () => {
    const filler = Array.from({ length: 120 }, (_, i) => `log line ${i} ok`).join('\n');
    const secretLine = `leaked ghp_${'x'.repeat(24)}`;
    const raw = `${filler}\n${secretLine}`;
    const out = redactOutput(raw, 1500);
    expect(out).toContain('… (earlier chars elided)');
    expect(out).toContain('[line hidden: looked like a credential]');
    expect(out).not.toContain('ghp_');
  });
});

describe('verify carries redacted output', () => {
  it('includes bounded tail on result.output', () => {
    const stdout = `${Array.from({ length: 400 }, (_, i) => `step ${i} padding line`).join('\n')}\nFINAL LINE`;
    const evidence = verify({ type: 'log_event' }, { result: { success: true, result: { exitCode: 0, stdout } } });
    expect(evidence.output).toContain('FINAL LINE');
    expect(evidence.output).toContain('… (earlier chars elided)');
  });
});
