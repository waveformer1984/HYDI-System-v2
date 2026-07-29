# HYDI API Reference

## CLI

```bash
hydi status
hydi readiness
hydi health
hydi architecture verify
hydi architecture audit
hydi architecture report
```

## Architecture Guard

```js
const ArchitectureGuard = require('./src/hydi-v3/ArchitectureGuard');
const guard = new ArchitectureGuard({ projectRoot: process.cwd() });
const report = guard.verify();
console.log(ArchitectureReport.render(report));
```

## Soak Harness

```js
const SoakHarness = require('./src/hydi-v3/SoakHarness');
const h = new SoakHarness({ durationMs: 60000 });
const report = await h.run(['federationJoinLeave', 'marketplaceInstallRemove']);
```

## Resource Auditor

```js
const ResourceAuditor = require('./src/hydi-v3/ResourceAuditor');
const a = new ResourceAuditor({ eventBus });
const before = a.snapshot('before');
// ... run operation ...
const after = a.snapshot('after');
const { ok } = a.checkLeak(before, after);
```

## Performance Baseline

```js
const PerformanceBaseline = require('./src/hydi-v3/PerformanceBaseline');
const pb = new PerformanceBaseline();
const report = await pb.capture(5);
pb.save(report);
```

## Determinism Guard

```js
const DeterminismGuard = require('./src/hydi-v3/DeterminismGuard');
const g = new DeterminismGuard({ iterations: 20 });
const report = await g.run(() => compute());
```
