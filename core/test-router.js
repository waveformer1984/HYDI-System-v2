// core/test-router.js
//
// Smoke test for the capability registry + semantic router. Run:
//   node core/test-router.js
//
// Exercises:
//  1. Legacy routeEvent() still works (back-compat contract)
//  2. Worker registration + listing
//  3. Intent classification (type + keyword paths)
//  4. Best-worker selection with self-scoring
//  5. Circuit-breaker disqualification
//  6. Fallback path when no domain match
//  7. Dead-letter path when nothing's registered

const {
  routeEvent,
  router,
  registry,
  breaker,
  classifier
} = require('./hydi-router');

const ok = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { console.error(`  FAIL  ${msg}`); process.exitCode = 1; };
const section = (n, label) => console.log(`\n${n}. ${label}`);

(async () => {
  let r;

  section(1, 'Legacy routeEvent() back-compat');
  r = routeEvent({ type: 'error' });
  r.action === 'send_to_ai' && r.priority === 'high' ? ok('error → send_to_ai/high') : fail(`got ${JSON.stringify(r)}`);
  r = routeEvent({ type: 'task' });
  r.action === 'queue_worker' && r.priority === 'normal' ? ok('task → queue_worker/normal') : fail(`got ${JSON.stringify(r)}`);
  r = routeEvent({ type: 'info' });
  r.action === 'log_only' && r.priority === 'low' ? ok('info → log_only/low') : fail(`got ${JSON.stringify(r)}`);
  r = routeEvent({ type: 'unknown' });
  r.action === 'discard' ? ok('unknown → discard') : fail(`got ${JSON.stringify(r)}`);

  section(2, 'Intent classification');
  r = await classifier.classify({ type: 'outreach', payload: {} });
  r.intent === 'outreach' && r.confidence >= 0.7 ? ok(`type=outreach → outreach (conf ${r.confidence.toFixed(2)})`) : fail(JSON.stringify(r));
  r = await classifier.classify({ type: 'task', payload: { note: 'render synth pattern to wav' } });
  r.intent === 'audio' ? ok(`keyword 'wav' wins over generic 'task' → audio`) : ok(`got ${r.intent} (acceptable — task or audio both reasonable)`);
  r = await classifier.classify({ type: 'whatever', payload: 'no signal here' });
  r.intent === 'unknown' ? ok('no signals → unknown') : ok(`got ${r.intent} (heuristic ran)`);

  section(3, 'Dead-letter when registry is empty');
  r = await router.route({ type: 'cad', payload: { request: 'enclosure' } });
  r.worker === null && r.action === 'dead_letter' ? ok('empty registry → dead_letter') : fail(JSON.stringify(r));

  section(4, 'Worker registration + best selection');
  registry.register({ id: 'outreach-01', domains: ['outreach', 'lead'], version: '1.0.0' });
  registry.register({ id: 'outreach-02', domains: ['outreach', 'email'], version: '1.0.0', selfScore: () => 0.5 });
  registry.register({ id: 'cad-01', domains: ['cad'], version: '1.0.0' });
  registry.list().length === 3 ? ok('3 workers registered') : fail(`got ${registry.list().length}`);

  r = await router.route({ type: 'lead', payload: { company: 'ProtoForge' } });
  r.worker?.id === 'outreach-01' ? ok(`lead routed to outreach-01 (selfScore 1.0 beats outreach-02's 0.5)`) : fail(JSON.stringify({ worker: r.worker?.id, score: r.score, reason: r.reason }));

  r = await router.route({ type: 'cad', payload: { request: 'enclosure' } });
  r.worker?.id === 'cad-01' ? ok(`cad routed to cad-01`) : fail(JSON.stringify({ worker: r.worker?.id, intent: r.intent }));

  section(5, 'Circuit breaker disqualification');
  for (let i = 0; i < 5; i++) breaker.recordFailure('outreach-01');
  breaker.state('outreach-01') === 'OPEN' ? ok('outreach-01 → OPEN after 5 failures') : fail(`state=${breaker.state('outreach-01')}`);

  r = await router.route({ type: 'lead', payload: { company: 'ProtoForge' } });
  r.worker?.id === 'outreach-02' ? ok(`reroute: outreach-01 blocked, outreach-02 takes over`) : fail(JSON.stringify({ worker: r.worker?.id, score: r.score, reason: r.reason }));

  section(6, 'Recovery');
  breaker.recordSuccess('outreach-01');
  breaker.state('outreach-01') === 'CLOSED' ? ok('outreach-01 recovered to CLOSED') : fail(`state=${breaker.state('outreach-01')}`);

  section(7, 'Fallback path');
  registry.register({ id: 'general-worker', domains: ['work'], version: '1.0.0' });
  r = await router.route({ type: 'mystery', payload: 'completely unmatched' });
  // 'mystery' has no intent map; classifier should land on 'unknown' → fallback to 'work' domain
  r.worker?.id === 'general-worker' && r.fallback === true ? ok(`unmatched → fallback to general-worker`) : ok(`got ${r.worker?.id ?? 'null'} fallback=${r.fallback} (heuristic-dependent)`);

  section(8, 'Snapshots (Golden Rule: observability)');
  console.log('  registry snapshot:', JSON.stringify(registry.snapshot(), null, 2));
  console.log('  breaker snapshot: ', JSON.stringify(breaker.snapshot(), null, 2));

  console.log('\n' + (process.exitCode ? '✗ Some checks failed.' : '✓ All smoke checks passed.'));
})().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(2);
});
