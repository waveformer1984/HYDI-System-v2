'use strict';

/**
 * Human Action store durability tests — the wipe regression.
 *
 * On 2026-10-10 the production store was found containing only actions
 * minted in a single daemon sweep: load() had returned an empty db on a
 * failed/corrupt read, and the next save() overwrote every durable record.
 * These tests pin the fail-closed contract:
 *   - missing file  → empty db (fresh start is legitimate)
 *   - corrupt file  → throw (never convert a bad read into a wiped store)
 *   - save()        → previous file preserved at <path>.bak
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-store-'));
const tmpFile = path.join(tmpDir, 'human-actions.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { load, save } = require('../../lib/human-actions/store');
const { HumanActionService } = require('../../lib/human-actions/service');

describe('human-actions store durability', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
  });

  test('load() returns an empty db when the store does not exist', () => {
    const db = load();
    expect(db.version).toBe(2);
    expect(db.actions).toEqual([]);
  });

  test('load() throws on a corrupt store and leaves the file intact', () => {
    const corrupt = '{"version":2,"actions":[{"id":"ha_abc","blockerKey":"x"}';
    fs.writeFileSync(tmpFile, corrupt);

    expect(() => load()).toThrow(/corrupt|refusing to load/i);
    // The durable bytes are untouched — an operator can repair by hand.
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe(corrupt);
  });

  test('a corrupt store cannot be wiped through the service request path', () => {
    const corrupt = 'not json at all {{{';
    fs.writeFileSync(tmpFile, corrupt);

    const svc = new HumanActionService();
    expect(() => svc.request({
      blockerKey: 'some:blocker', type: 'deployment', title: 't',
      description: 'd', instructions: ['i'], verifier: { name: 'manual', spec: {} },
    })).toThrow();

    expect(fs.readFileSync(tmpFile, 'utf8')).toBe(corrupt);
  });

  test('save() preserves the previous file at <store>.bak', () => {
    save({ version: 2, actions: [{ id: 'ha_1', blockerKey: 'k1', status: 'OPEN', transitions: [] }] });
    save({ version: 2, actions: [
      { id: 'ha_1', blockerKey: 'k1', status: 'OPEN', transitions: [] },
      { id: 'ha_2', blockerKey: 'k2', status: 'OPEN', transitions: [] },
    ] });

    const bak = JSON.parse(fs.readFileSync(tmpFile + '.bak', 'utf8'));
    expect(bak.actions).toHaveLength(1);
    expect(bak.actions[0].id).toBe('ha_1');

    const cur = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(cur.actions).toHaveLength(2);
  });

  test('save→load round-trips records, and load() throws on an unreadable non-ENOENT path', () => {
    save({ version: 2, actions: [{ id: 'ha_x', blockerKey: 'k', status: 'RESOLVED', transitions: [] }] });
    expect(load().actions[0].id).toBe('ha_x');

    // A directory where the file should be is not ENOENT — it is EISDIR/ENOTDIR.
    const dirAsFile = path.join(tmpDir, 'asdir');
    fs.mkdirSync(dirAsFile);
    process.env.HYDI_HUMAN_ACTIONS_FILE = dirAsFile;
    expect(() => load()).toThrow();
    process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;
  });
});
