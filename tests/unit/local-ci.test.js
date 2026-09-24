/**
 * Unit tests for scripts/local-ci.js's pure helpers. The script itself
 * shells out to git/npm and calls the GitHub API, so only its decision
 * logic is exercised here -- above all, that fork PRs are never selected.
 */

const { CHECKS, REPO, parseArgs, summarizeJest, describe: describeStatus, selectPullsToTest } = require('../../scripts/local-ci');

function pr(number, sha, fullName = REPO) {
  return { number, head: { sha, ref: `branch-${number}`, repo: fullName ? { full_name: fullName } : null } };
}

function finalStatuses(state = 'success') {
  return CHECKS.map((c) => ({ context: c.context, state }));
}

describe('parseArgs', () => {
  it('defaults to testing HEAD and posting', () => {
    expect(parseArgs([])).toEqual({ target: 'HEAD', pr: null, watch: false, once: false, post: true, intervalMin: 10 });
  });

  it('reads --pr, --watch, --once, --no-post and --interval', () => {
    expect(parseArgs(['--pr', '276', '--no-post'])).toMatchObject({ pr: 276, post: false });
    expect(parseArgs(['--watch', '--once', '--interval', '5'])).toMatchObject({ watch: true, once: true, intervalMin: 5 });
  });

  it('takes a positional ref', () => {
    expect(parseArgs(['abc123']).target).toBe('abc123');
  });

  it('rejects unknown options and bad numbers', () => {
    expect(() => parseArgs(['--nope'])).toThrow('unknown option');
    expect(() => parseArgs(['--pr', 'x'])).toThrow('--pr');
    expect(() => parseArgs(['--interval', '0'])).toThrow('--interval');
  });
});

describe('summarizeJest', () => {
  it('returns the last Tests: line with whitespace collapsed', () => {
    const out = 'PASS a\nTests:       1 passed, 1 total\nmore\nTests:       2 failed, 60 passed, 62 total\r\nTime: 3s';
    expect(summarizeJest(out)).toBe('Tests: 2 failed, 60 passed, 62 total');
  });

  it('returns null when there is no Jest summary', () => {
    expect(summarizeJest('tsc --noEmit\n')).toBeNull();
  });
});

describe('describe', () => {
  it('truncates to GitHub\'s 140-character limit', () => {
    expect(describeStatus('x'.repeat(200))).toHaveLength(140);
    expect(describeStatus('short')).toBe('short');
  });
});

describe('selectPullsToTest', () => {
  it('never selects a fork PR, even without statuses', () => {
    const pulls = [pr(1, 'aaa', 'someone/HYDI-System-v2'), pr(2, 'bbb', null)];
    expect(selectPullsToTest(pulls, {})).toEqual([]);
  });

  it('selects a same-repo PR with no local-ci statuses', () => {
    const pulls = [pr(3, 'ccc')];
    expect(selectPullsToTest(pulls, { ccc: [{ context: 'Jest Unit Tests', state: 'failure' }] })).toEqual(pulls);
  });

  it('skips a head where every check has a final result', () => {
    expect(selectPullsToTest([pr(4, 'ddd')], { ddd: finalStatuses('failure') })).toEqual([]);
  });

  it('re-selects a head whose latest status for a check is still pending', () => {
    const statuses = [{ context: CHECKS[0].context, state: 'pending' }, ...finalStatuses('success')];
    expect(selectPullsToTest([pr(5, 'eee')], { eee: statuses })).toHaveLength(1);
  });

  it('re-selects a head missing one of the checks', () => {
    expect(selectPullsToTest([pr(6, 'fff')], { fff: finalStatuses().slice(1) })).toHaveLength(1);
  });
});
