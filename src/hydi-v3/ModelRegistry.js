'use strict';

class ModelRegistry {
  constructor() {
    this.models = new Map();
  }

  register(id, record) {
    this.models.set(id, {
      id,
      ...record,
      registeredAt: Date.now(),
    });
  }

  get(id) {
    return this.models.get(id);
  }

  find(query = {}) {
    let list = Array.from(this.models.values());
    if (query.capability) {
      list = list.filter((m) => (m.capabilities || []).includes(query.capability));
    }
    if (query.provider) list = list.filter((m) => m.provider === query.provider);
    if (query.healthy) list = list.filter((m) => m.healthy !== false);
    return list;
  }

  first(query) {
    return this.find(query)[0] || null;
  }

  all() {
    return Array.from(this.models.values());
  }

  clear() {
    this.models.clear();
  }
}

module.exports = ModelRegistry;
