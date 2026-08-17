const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DerivedStore, LineageGraph } = require('../src/derived-store');

function makeDerived(fingerprint, parent = null, children = []) {
  return {
    id: `cascade:${fingerprint}`,
    fingerprint,
    parentFingerprint: parent,
    children,
    payload: {},
    normalizedPayload: {}
  };
}

describe('LineageGraph', () => {
  it('finds children and descendants', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-lineage-'));
    const store = new DerivedStore({ dataDir: dir });
    const lineage = new LineageGraph(store);

    const a = makeDerived('a', null, ['b', 'c']);
    const b = makeDerived('b', 'a', ['d']);
    const c = makeDerived('c', 'a', []);
    const d = makeDerived('d', 'b', []);

    store.add(a);
    store.add(b);
    store.add(c);
    store.add(d);

    const l = lineage.getLineage('a');
    assert.strictEqual(l.ok, true);
    assert.deepStrictEqual(l.children, ['b', 'c']);
    assert.deepStrictEqual(l.descendants, ['b', 'c', 'd']);
    assert.deepStrictEqual(l.ancestors, []);
  });

  it('finds ancestors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-ancestors-'));
    const store = new DerivedStore({ dataDir: dir });
    const lineage = new LineageGraph(store);

    const a = makeDerived('a', null, ['b']);
    const b = makeDerived('b', 'a', ['c']);
    const c = makeDerived('c', 'b', []);

    store.add(a);
    store.add(b);
    store.add(c);

    const l = lineage.getLineage('c');
    assert.deepStrictEqual(l.ancestors, ['b', 'a']);
    assert.deepStrictEqual(l.children, []);
  });

  it('returns 404 for unknown fingerprint', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-missing-'));
    const store = new DerivedStore({ dataDir: dir });
    const lineage = new LineageGraph(store);
    const l = lineage.getLineage('missing');
    assert.strictEqual(l.ok, false);
    assert.strictEqual(l.code, '404');
  });

  it('handles cycles safely', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-cycles-'));
    const store = new DerivedStore({ dataDir: dir });
    const lineage = new LineageGraph(store);

    const a = makeDerived('a', 'b', ['b']);
    const b = makeDerived('b', 'a', ['a']);
    store.add(a);
    store.add(b);

    const l = lineage.getLineage('a');
    assert.strictEqual(l.ancestors.length, 1);
    assert.strictEqual(l.ancestors[0], 'b');
    assert.strictEqual(l.descendants.length, 1);
    assert.strictEqual(l.descendants[0], 'b');
  });
});
