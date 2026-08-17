const fs = require('fs');
const path = require('path');

const defaultCatalogPath = path.join(__dirname, '..', '..', '..', 'rezonate', 'samples-catalog.json');

class SampleLibraryAdapter {
  constructor(options = {}) {
    this.catalogPath = options.catalogPath || defaultCatalogPath;
    this._read = options.readFile || (p => fs.readFileSync(p, 'utf8'));
    this._catalog = options.catalog || null;
    this._logger = options.logger || { warn: () => {} };
  }

  _load() {
    if (this._catalog) return this._catalog;
    try {
      const raw = this._read(this.catalogPath);
      const parsed = JSON.parse(raw);
      this._catalog = Array.isArray(parsed) ? parsed : (parsed.samples || []);
      return this._catalog;
    } catch (err) {
      this._logger.warn('sample-library', 'load.failed', err.message);
      this._catalog = [];
      return this._catalog;
    }
  }

  all() {
    return this._load().slice();
  }

  searchSamples(query = '') {
    const q = String(query).toLowerCase();
    return this._load().filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.tags && s.tags.some(t => t.toLowerCase().includes(q))) ||
      (s.folder && s.folder.toLowerCase().includes(q))
    );
  }

  getSample(name) {
    return this._load().find(s => s.name === name) || null;
  }

  filterByInstrument(instrument) {
    const q = String(instrument).toLowerCase();
    return this._load().filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.tags && s.tags.some(t => t.toLowerCase() === q || t.toLowerCase().includes(q)))
    );
  }

  filterByBPM(min = 0, max = Infinity) {
    return this._load().filter(s =>
      s.bpm != null && s.bpm >= min && s.bpm <= max
    );
  }

  filterByKey(key = '') {
    const q = key.trim().toLowerCase();
    return this._load().filter(s =>
      s.key && s.key.toLowerCase().includes(q)
    );
  }

  summary() {
    const samples = this._load();
    const withBpm = samples.filter(s => s.bpm != null).length;
    const withKey = samples.filter(s => s.key != null).length;
    return { total: samples.length, withBpm, withKey };
  }
}

module.exports = { SampleLibraryAdapter };
