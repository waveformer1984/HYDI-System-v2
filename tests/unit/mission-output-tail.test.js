'use strict';
// Mission output keeps the TAIL and still redacts secrets in it.
const { verify } = require('../../heidi-core/missions/lifecycle.js');

const run = (stdout, exitCode = 0) => ({ result: { result: { stdout, stderr: '', exitCode } } });

describe('verify output bounds — tail, not head', () => {
  it('keeps the last line (the Jest summary) when output exceeds the limit', () => {
    const head = 'test suite starting\n' + 'filler line x\n'.repeat(300);
    const tail = 'Tests: 2 failed, 40 passed\nFAIL tests/unit/foo.test.js';
    const { output } = verify({}, run(head + tail));
    expect(output).toContain(tail); // the end survives
    expect(output).toMatch(/earlier chars elided/);
    expect(output).not.toContain('test suite starting'); // the head is cut
  });
  it('short output comes through whole', () => {
    const { output } = verify({}, run('Tests: 3 passed'));
    expect(output).toBe('Tests: 3 passed');
  });
  it('redaction still runs on the kept tail', () => {
    const secret = 'token = hunter2secret\nAPI_KEY = deadbeef1234';
    const filler = 'filler\n'.repeat(300);
    const { output } = verify({}, run(filler + secret));
    expect(output).not.toContain('hunter2secret'); // secret hidden even in the kept tail
    expect(output).not.toContain('deadbeef1234');
    expect(output).toMatch(/looked like a credential|hidden/);
  });
});
