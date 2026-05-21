// core/intent-classifier.js
//
// Maps an event → { intent, confidence, signals }.
//
// Default implementation is keyword/type-based (fast, no network). You can
// register additional async classifiers (LLM, model) via `addClassifier()`;
// the highest-confidence result wins. This is the "Intent Parser" stage of
// the Pathways doc:  Input → Intent Parser → Capability Registry → Worker.

// Built-in mappings from event.type to intent. Extend as needed.
const TYPE_MAP = {
  error: 'diagnostic',
  task: 'work',
  info: 'log',
  outreach: 'outreach',
  lead: 'outreach',
  cad: 'cad',
  audio: 'audio',
  analysis: 'analysis',
  repair: 'repair',
  research: 'research',
  vision: 'vision'
};

// Keyword → intent fallback. Scans event.type and stringified payload.
const KEYWORD_MAP = [
  { intent: 'outreach', terms: ['lead', 'email', 'outreach', 'campaign', 'crm'] },
  { intent: 'cad', terms: ['stl', 'cad', 'mesh', '3d print', 'enclosure'] },
  { intent: 'audio', terms: ['render', 'wav', 'mp3', 'midi', 'synth', 'pattern'] },
  { intent: 'analysis', terms: ['analyze', 'score', 'compute', 'metric', 'stat'] },
  { intent: 'diagnostic', terms: ['error', 'fail', 'crash', 'exception', 'stack'] },
  { intent: 'work', terms: ['task', 'job', 'queue', 'process'] }
];

function defaultClassifier(event) {
  const signals = [];

  // 1. Direct type → intent match
  if (event.type && TYPE_MAP[event.type]) {
    signals.push({ source: 'type', value: event.type, intent: TYPE_MAP[event.type] });
  }

  // 2. Keyword scan over type + payload (cheap heuristic)
  const haystack = [
    event.type || '',
    typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload || {})
  ].join(' ').toLowerCase();

  for (const { intent, terms } of KEYWORD_MAP) {
    for (const t of terms) {
      if (haystack.includes(t)) {
        signals.push({ source: 'keyword', value: t, intent });
      }
    }
  }

  if (signals.length === 0) {
    return { intent: 'unknown', confidence: 0.1, signals: [] };
  }

  // Tally intents; pick the most-supported. Confidence scales with signal density.
  const tally = {};
  for (const s of signals) tally[s.intent] = (tally[s.intent] || 0) + 1;
  const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const intent = winner[0];
  const supporting = winner[1];
  // 1 signal → 0.5, 2 → 0.7, 3+ → cap at 0.9. Exact-type match always ≥ 0.7.
  const exactType = signals.some((s) => s.source === 'type' && s.intent === intent);
  let confidence = Math.min(0.9, 0.4 + supporting * 0.15);
  if (exactType) confidence = Math.max(confidence, 0.7);

  return { intent, confidence, signals };
}

class IntentClassifier {
  constructor() {
    this.classifiers = [defaultClassifier];
  }

  // Register additional async classifiers (e.g., LLM-backed). Each one returns
  // { intent, confidence, signals } and the highest-confidence wins.
  addClassifier(fn) {
    this.classifiers.push(fn);
  }

  async classify(event) {
    const results = await Promise.all(
      this.classifiers.map(async (fn) => {
        try {
          return await fn(event);
        } catch (e) {
          return { intent: 'unknown', confidence: 0, signals: [], error: e.message };
        }
      })
    );
    return results.sort((a, b) => b.confidence - a.confidence)[0];
  }
}

module.exports = { IntentClassifier, defaultClassifier };
