function createDefaultAdapters() {
  const adapters = new Map();

  adapters.set('1', payload => ({ ...payload, cascadeVersion: 1 }));

  adapters.set('2', payload => ({
    ...payload,
    cascadeVersion: 2,
    parentFingerprint: payload.parent || payload.parentFingerprint || null
  }));

  return adapters;
}

module.exports = { createDefaultAdapters };
