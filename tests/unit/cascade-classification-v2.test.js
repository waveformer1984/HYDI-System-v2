/**
 * CASCADE V2 classifier (modules/cascade-classification-v2.js).
 *
 * ISSUES_FOUND.md #80: the classifier used to require EVERY pattern in a
 * category to match. INFRA_FAILURE and ROUTE_FAILURE could never match
 * (mutually exclusive exact values on one field), and the other three
 * needed all five of their fields at once, so nearly every event was
 * UNKNOWN_ANOMALY and quarantined. The rule is now the V1 rule
 * (modules/cascade-core.js classifyEvent): any one indicator group matches
 * a category, first matching category in order wins, and V1's two
 * combinations are kept (database down; route/endpoint + HTTP error).
 */

const CascadeClassificationV2 = require('../../modules/cascade-classification-v2');

function classify(payload) {
  return new CascadeClassificationV2().classify({ payload });
}

describe('CascadeClassificationV2 — any indicator group matches its category', () => {
  describe('INFRA_FAILURE', () => {
    it.each([
      [{ error_code: 'MODULE_NOT_FOUND' }, 'INFRA_FAILURE:error_code=MODULE_NOT_FOUND'],
      [{ error_code: 'ECONNREFUSED' }, 'INFRA_FAILURE:error_code=ECONNREFUSED'],
      [{ error_code: 'ENOTFOUND' }, 'INFRA_FAILURE:error_code=ENOTFOUND'],
      [{ error: 'Cannot resolve module "pg"' }, 'INFRA_FAILURE:error~Cannot resolve module'],
      [{ error: 'Connection refused by 127.0.0.1' }, 'INFRA_FAILURE:error~Connection refused'],
      [{ error: '503 Service unavailable' }, 'INFRA_FAILURE:error~Service unavailable'],
      [{ service: 'database', status: 'down' }, 'INFRA_FAILURE:service=database+status=down'],
    ])('classifies %j', (payload, rule) => {
      const result = classify(payload);
      expect(result.classification).toBe('INFRA_FAILURE');
      expect(result.quarantine).toBe(false);
      expect(result.confidence).toBe(0.9);
      expect(result.matched_rules).toContain(rule);
    });

    it('needs both halves of the database-down combination (V1 rule)', () => {
      expect(classify({ service: 'database' }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ status: 'down' }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ service: 'database', status: 'up' }).classification).toBe('UNKNOWN_ANOMALY');
    });

    it('classifies the event test-cascade-v2.js labels "Valid INFRA_FAILURE"', () => {
      expect(classify({ module: 'database', error_code: 'MODULE_NOT_FOUND', error: 'Cannot find module "pg"' }).classification)
        .toBe('INFRA_FAILURE');
    });

    it('records every matching group of the winning category', () => {
      const result = classify({ error_code: 'ECONNREFUSED', error: 'Connection refused' });
      expect(result.matched_rules).toEqual([
        'INFRA_FAILURE:error_code=ECONNREFUSED',
        'INFRA_FAILURE:error~Connection refused',
      ]);
    });
  });

  describe('ROUTE_FAILURE — a route or endpoint plus an HTTP error signal (V1 rule)', () => {
    it.each([
      [{ route: '/api/chat', status_code: 500 }, 'ROUTE_FAILURE:route+status_code:400-599'],
      [{ endpoint: '/health', status_code: 404 }, 'ROUTE_FAILURE:endpoint+status_code:400-599'],
      [{ route: '/api/chat', http_error: 'ETIMEDOUT' }, 'ROUTE_FAILURE:route+http_error'],
      [{ endpoint: '/x', error: 'upstream returned 404' }, 'ROUTE_FAILURE:endpoint+error~404'],
      [{ route: '/x', error: 'HTTP 500' }, 'ROUTE_FAILURE:route+error~500'],
    ])('classifies %j', (payload, rule) => {
      const result = classify(payload);
      expect(result.classification).toBe('ROUTE_FAILURE');
      expect(result.matched_rules).toEqual([rule]);
    });

    it('does not classify a route without an error, or an error without a route', () => {
      expect(classify({ route: '/api/chat', status_code: 200 }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ endpoint: '/x' }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ status_code: 500 }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ error: 'waited 500ms' }).classification).toBe('UNKNOWN_ANOMALY');
    });

    it('keeps the 400-599 range check', () => {
      expect(classify({ route: '/x', status_code: 399 }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ route: '/x', status_code: 600 }).classification).toBe('UNKNOWN_ANOMALY');
      expect(classify({ route: '/x', status_code: 'n/a' }).classification).toBe('UNKNOWN_ANOMALY');
    });
  });

  describe.each([
    ['DEPLOYMENT_MISMATCH', ['env_var_missing', 'version_mismatch', 'config_diff', 'deployment_error', 'build_failed']],
    ['DATA_INTEGRITY_RISK', ['corruption_detected', 'checksum_mismatch', 'data_validation_failed', 'integrity_check_failed', 'data_loss']],
    ['STREAM_BREAK', ['stream_disconnected', 'connection_lost', 'websocket_error', 'stream_error', 'disconnect']],
  ])('%s', (category, fields) => {
    it.each(fields)('classifies an event carrying only %s', (field) => {
      const result = classify({ [field]: true });
      expect(result.classification).toBe(category);
      expect(result.matched_rules).toEqual([`${category}:${field}`]);
    });

    it('still classifies when every indicator is present', () => {
      expect(classify(Object.fromEntries(fields.map((f) => [f, true]))).classification).toBe(category);
    });
  });

  it('classifies the STREAM_BREAK event from test-cascade-system.js (2 of 5 fields)', () => {
    expect(classify({ stream_id: 'user-stream-123', websocket_error: true, connection_lost: true }).classification)
      .toBe('STREAM_BREAK');
  });
});

describe('CascadeClassificationV2 — unchanged behaviour', () => {
  it('picks the first matching category in the fixed order', () => {
    expect(classify({ stream_disconnected: true, error_code: 'ECONNREFUSED' }).classification).toBe('INFRA_FAILURE');
    expect(classify({ checksum_mismatch: true, env_var_missing: 'X' }).classification).toBe('DEPLOYMENT_MISMATCH');
    expect(classify({ disconnect: true, data_loss: true }).classification).toBe('DATA_INTEGRITY_RISK');
  });

  it('quarantines anything with no matching indicator as UNKNOWN_ANOMALY at 0.3', () => {
    const result = classify({ weird_signal: true, cosmic_ray: 'detected' });
    expect(result).toMatchObject({
      classification: 'UNKNOWN_ANOMALY', confidence: 0.3, quarantine: true, matched_rules: [], reasons: ['No matching pattern found'],
    });
  });

  it('quarantines an event with no payload at 0.5', () => {
    const result = new CascadeClassificationV2().classify({});
    expect(result).toMatchObject({ classification: 'UNKNOWN_ANOMALY', confidence: 0.5, quarantine: true });
  });

  it('keeps field-level `exists` semantics: a present-but-false flag still counts', () => {
    // Characterization, not an endorsement: V1 used truthiness here. Left
    // unchanged because #80 is about the category combination rule only;
    // see ISSUES_FOUND.md #80's follow-up note.
    expect(classify({ build_failed: false }).classification).toBe('DEPLOYMENT_MISMATCH');
  });

  it('matches exact values exactly (no case folding)', () => {
    expect(classify({ error_code: 'econnrefused' }).classification).toBe('UNKNOWN_ANOMALY');
  });

  it('counts classifications per category', () => {
    const c = new CascadeClassificationV2();
    c.classify({ payload: { stream_error: 'x' } });
    c.classify({ payload: { stream_error: 'y' } });
    c.classify({ payload: { nothing: 1 } });
    const stats = c.getStats();
    expect(stats.classificationCounts.STREAM_BREAK).toBe(2);
    expect(stats.unknownCount).toBe(1);
    expect(stats.totalClassifications).toBe(3);
  });

  it('only ever returns one of the six enum values', () => {
    const c = new CascadeClassificationV2();
    for (const payload of [{}, { a: 1 }, { route: '/x', status_code: 503 }, { data_loss: 1 }]) {
      expect(c.getAllowedClassifications()).toContain(c.classify({ payload }).classification);
    }
  });
});
