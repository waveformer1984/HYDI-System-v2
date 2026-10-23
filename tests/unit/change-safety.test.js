'use strict';

const {
  evaluateChange,
  isForbiddenGeneratedPath,
  newlyAddedMatches,
} = require('../../scripts/check-change-safety');

const jwt = () => ['eyJhbGci', 'OiJIUzI1NiJ9', '.payload.signature'].join('');
const credential = (kind, suffix = 'realvalue123') => `${kind}_${suffix}`;
const privateKey = (body = 'c2VjcmV0LWtleS1tYXRlcmlhbA==') => [
  '-----' + 'BEGIN PRIVATE KEY-----',
  body,
  '-----' + 'END PRIVATE KEY-----',
].join('\n');

describe('change safety gate', () => {
  test.each([
    ['JWT', jwt()],
    ['Stripe secret key', credential('sk_live')],
    ['Stripe restricted key', credential('rk_live')],
    ['webhook signing secret', credential('whsec')],
    ['private key', privateKey()],
  ])('rejects an added %s', (_name, value) => {
    const errors = evaluateChange({
      changedFiles: ['src/config.js'],
      addedFiles: [],
      snapshots: [{ path: 'src/config.js', before: '', after: `export default ${JSON.stringify(value)};` }],
    });
    expect(errors).toEqual([expect.stringContaining('src/config.js: added')]);
  });

  it('permits only recognizable fake values under tests/fixtures', () => {
    const fake = credential('sk_live', 'known_fake_fixture');
    expect(evaluateChange({
      changedFiles: ['tests/fixtures/provider.json'],
      snapshots: [{ path: 'tests/fixtures/provider.json', before: '', after: fake }],
    })).toEqual([]);
    expect(evaluateChange({
      changedFiles: ['tests/unit/provider.test.js'],
      snapshots: [{ path: 'tests/unit/provider.test.js', before: '', after: fake }],
    })).not.toEqual([]);
    expect(evaluateChange({
      changedFiles: ['tests/fixtures/provider.json'],
      snapshots: [{ path: 'tests/fixtures/provider.json', before: '', after: credential('sk_live') }],
    })).not.toEqual([]);
  });

  it('does not flag a sensitive value that was already present in the base', () => {
    const value = credential('whsec', 'existingvalue123');
    expect(newlyAddedMatches(`a=${value}`, `a=${value}\nchanged=true`)).toEqual([]);
  });

  test.each([
    'coverage/lcov.info',
    'packages/app/vendor/library.js',
    'data/orders.json',
    '.runtime/state.json',
    'services/logs/app.txt',
    'debug.log',
  ])('rejects an added generated/runtime path: %s', (file) => {
    expect(isForbiddenGeneratedPath(file)).toBe(true);
    expect(evaluateChange({ changedFiles: [file], addedFiles: [file] }))
      .toEqual([`${file}: generated/runtime path may not be added`]);
  });

  it('rejects more than 300 touched files without the approval label', () => {
    const changedFiles = Array.from({ length: 301 }, (_, index) => `src/file-${index}.js`);
    expect(evaluateChange({ changedFiles })).toEqual([
      expect.stringContaining('change touches 301 files'),
    ]);
    expect(evaluateChange({ changedFiles, labels: ['large-change-approved'] })).toEqual([]);
  });
});
