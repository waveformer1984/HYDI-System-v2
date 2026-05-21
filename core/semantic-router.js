// core/semantic-router.js
//
// Composes IntentClassifier + CapabilityRegistry + CircuitBreaker into a single
// `route(event)` call. This is the "best worker selection" stage of the
// Pathways doc, and it implements the scoring model sketched in the pattern
// analysis (mirroring Heidi's computeConfidence shape).
//
// Returns: { worker, intent, confidence, score, reason, fallback }
//   worker:     the chosen worker registration, or null if none
//   intent:     classified intent
//   confidence: intent confidence (from classifier)
//   score:      final routing score, [0, 1]
//   reason:     object with the score breakdown (auditable, per Golden Rule)
//   fallback:   true if this is a degraded fallback selection

const { IntentClassifier } = require('./intent-classifier');
const { CapabilityRegistry } = require('./capability-registry');
const { CircuitBreaker } = require('./circuit-breaker');

class SemanticRouter {
  constructor({ classifier, registry, breaker } = {}) {
    this.classifier = classifier || new IntentClassifier();
    this.registry = registry || new CapabilityRegistry();
    this.breaker = breaker || new CircuitBreaker();
  }

  async route(event) {
    const { intent, confidence, signals } = await this.classifier.classify(event);

    // Candidate workers: anyone declaring the intent as a domain.
    const candidates = this.registry.find(intent);

    if (candidates.length === 0) {
      // Nothing matched. Try "work" / "diagnostic" as broad fallback domains.
      const fallback = this.registry.findAny(['work', 'diagnostic']);
      if (fallback.length === 0) {
        return {
          worker: null,
          intent,
          confidence,
          score: 0,
          reason: {
            base: 0.3,
            intentBonus: 0,
            workerScore: 0,
            failurePenalty: 0,
            fallbackPenalty: 0.2,
            notes: ['no worker matched intent', 'no fallback worker available']
          },
          fallback: false,
          action: 'dead_letter'
        };
      }
      // Score the fallback workers
      const scored = await this._scoreAll(fallback, event, confidence, true);
      const best = scored[0];
      return {
        worker: best.worker,
        intent,
        confidence,
        score: best.score,
        reason: best.reason,
        fallback: true,
        action: 'queue_worker'
      };
    }

    const scored = await this._scoreAll(candidates, event, confidence, false);
    const best = scored[0];
    return {
      worker: best.worker,
      intent,
      confidence,
      score: best.score,
      reason: best.reason,
      fallback: false,
      action: 'queue_worker',
      signals
    };
  }

  // Score all workers and return sorted by score desc.
  async _scoreAll(workers, event, intentConfidence, isFallback) {
    const scored = await Promise.all(
      workers.map(async (worker) => {
        // Step 1: base
        const base = 0.3;
        // Step 2: intent match bonus — scales with classifier confidence
        const intentBonus = intentConfidence * 0.3;
        // Step 3: worker self-score (load, capability fit, etc.) — capped at 0.3
        let workerScore = 0;
        try {
          workerScore = Math.min(0.3, Number(await worker.selfScore(event)) * 0.3);
        } catch (_) {
          workerScore = 0;
        }
        // Step 4: failure penalty from circuit breaker
        const failurePenalty = this.breaker.failurePenalty(worker.id) * 0.2;
        // Step 5: fallback penalty
        const fallbackPenalty = isFallback ? 0.2 : 0;
        // Step 6: circuit breaker OPEN → disqualify (score forced low)
        const cbState = this.breaker.state(worker.id);
        const blocked = cbState === 'OPEN';

        const raw = base + intentBonus + workerScore - failurePenalty - fallbackPenalty;
        const score = blocked ? 0 : Math.max(0, Math.min(1, raw));

        return {
          worker,
          score,
          reason: {
            base,
            intentBonus,
            workerScore,
            failurePenalty,
            fallbackPenalty,
            circuitBreaker: cbState,
            blocked,
            notes: blocked ? ['circuit breaker OPEN'] : []
          }
        };
      })
    );
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }
}

module.exports = { SemanticRouter };
