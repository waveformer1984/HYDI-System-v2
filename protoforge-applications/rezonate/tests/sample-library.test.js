const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SampleLibraryAdapter } = require('../src/adapters/sample-library');

const mockCatalog = [
  { name: 'kick_01.wav', path: 'C:\\audio\\kick_01.wav', tags: ['kick'], bpm: 120, key: 'C' },
  { name: 'snare_02.wav', path: 'C:\\audio\\snare_02.wav', tags: ['snare'], bpm: 128, key: 'F' },
  { name: 'bass_loop.wav', path: 'C:\\audio\\bass_loop.wav', tags: ['bass', 'loop'], bpm: 120, key: 'C minor' },
  { name: 'vocal_chop.wav', path: 'C:\\audio\\vocal_chop.wav', tags: ['vocal'], bpm: null, key: null }
];

describe('SampleLibraryAdapter', () => {
  it('loads catalog from provided catalog option', () => {
    const lib = new SampleLibraryAdapter({ catalog: mockCatalog });
    assert.strictEqual(lib.all().length, 4);
  });

  it('searches by name and tags', () => {
    const lib = new SampleLibraryAdapter({ catalog: mockCatalog });
    const results = lib.searchSamples('bass');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'bass_loop.wav');
  });

  it('gets a sample by name', () => {
    const lib = new SampleLibraryAdapter({ catalog: mockCatalog });
    const sample = lib.getSample('snare_02.wav');
    assert.ok(sample);
    assert.strictEqual(sample.bpm, 128);
    assert.strictEqual(lib.getSample('missing.wav'), null);
  });

  it('filters by instrument tag', () => {
    const lib = new SampleLibraryAdapter({ catalog: mockCatalog });
    const results = lib.filterByInstrument('kick');
    assert.strictEqual(results.length, 1);
    const loops = lib.filterByInstrument('loop');
    assert.strictEqual(loops.length, 1);
  });

  it('filters by BPM range', () => {
    const lib = new SampleLibraryAdapter({ catalog: mockCatalog });
    const results = lib.filterByBPM(110, 125);
    assert.strictEqual(results.length, 2);
  });

  it('filters by key', () => {
    const lib = new SampleLibraryAdapter({ catalog: mockCatalog });
    const results = lib.filterByKey('C');
    assert.strictEqual(results.length, 2);
  });

  it('returns empty array when catalog missing', () => {
    const lib = new SampleLibraryAdapter({
      catalogPath: 'missing.json',
      readFile: () => { throw new Error('not found'); }
    });
    assert.deepStrictEqual(lib.all(), []);
  });
});
