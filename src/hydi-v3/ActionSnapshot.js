'use strict';

/**
 * ActionSnapshot captures before/after state for an action and computes a
 * concise diff. It is intentionally generic: it can snapshot any subset of
 * BusinessMemory or a flat object map.
 */
class ActionSnapshot {
  /**
   * Capture a serializable snapshot of a memory subset.
   */
  static capture(memory, query = {}) {
    if (!memory) return null;
    const entities = memory.find ? memory.find(query) : memory;
    return {
      at: Date.now(),
      count: Array.isArray(entities) ? entities.length : Object.keys(entities).length,
      entities: Array.isArray(entities)
        ? entities.map((e) => ({ id: e.id, type: e.type, name: e.name, status: e.status, value: e.value }))
        : entities,
    };
  }

  /**
   * Compute a diff between two snapshots.
   */
  static diff(before, after) {
    if (!before || !after) {
      return { changed: false, added: [], removed: [], modified: [], beforeCount: before?.count ?? 0, afterCount: after?.count ?? 0 };
    }

    const beforeMap = ActionSnapshot._toMap(before.entities);
    const afterMap = ActionSnapshot._toMap(after.entities);
    const beforeIds = new Set(Object.keys(beforeMap));
    const afterIds = new Set(Object.keys(afterMap));

    const added = [...afterIds].filter((id) => !beforeIds.has(id)).map((id) => afterMap[id]);
    const removed = [...beforeIds].filter((id) => !afterIds.has(id)).map((id) => beforeMap[id]);
    const modified = [];

    for (const id of beforeIds) {
      if (!afterIds.has(id)) continue;
      const b = beforeMap[id];
      const a = afterMap[id];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        modified.push({ id, before: b, after: a });
      }
    }

    return {
      changed: added.length > 0 || removed.length > 0 || modified.length > 0,
      added,
      removed,
      modified,
      beforeCount: before.count,
      afterCount: after.count,
    };
  }

  static _toMap(entities) {
    const map = {};
    const arr = Array.isArray(entities) ? entities : (entities ? [entities] : []);
    for (const e of arr) {
      if (e && e.id) map[e.id] = e;
    }
    return map;
  }
}

module.exports = ActionSnapshot;
