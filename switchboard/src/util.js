function parseJson(json, fallback) {
  if (json == null) return fallback;
  if (typeof json === 'object') return json;
  try { return JSON.parse(json); } catch { return fallback; }
}

module.exports = { parseJson };
