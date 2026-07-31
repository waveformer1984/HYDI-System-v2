# ProtoForge Application Blueprint Extraction

## Source

The first reference application is **Switchboard** (`HYDI-System-v2/switchboard/`).

It is frozen at `v1.0.0` and must remain untouched. It is the specimen, not the workshop bench.

## Extraction Principle

Extract the **layer contracts** and **conventions** that made Switchboard production-grade. Do not extract the **domain logic** that makes Switchboard a gig marketplace.

A ProtoForge application should be a healthy empty organism first. Only then should it be taught specialized behavior.

---

## Keep as ProtoForge Patterns

These are reusable across any application generated from the blueprint.

```text
architecture/
├── API layer
│   ├── Express setup
│   ├── central router
│   ├── request ID middleware
│   ├── error handling middleware
│   └── rate limiting
├── Repository layer
│   ├── single persistence consumer
│   ├── validated CRUD pattern
│   ├── audit log emission
│   └── one event per state change
├── Store abstraction
│   ├── init()
│   ├── create(table, record)
│   ├── getById(table, id)
│   ├── getAll(table)
│   ├── update(table, id, record)
│   ├── delete(table, id)
│   └── load()
├── Persistence migrations
│   ├── schema version constant
│   ├── default tables object
│   └── migration ladder per version
├── Validation framework
│   ├── requireString
│   ├── requireDate
│   ├── requireOneOf
│   └── schema-specific validators
├── Error handling
│   ├── ValidationError
│   ├── NotFoundError
│   ├── ConflictError
│   └── HTTP status mapping
├── Configuration system
│   ├── env-driven createConfig()
│   ├── typed helpers (intOr, boolOr)
│   └── sane defaults
├── EventBus
│   ├── emit(type, payload)
│   ├── on(type, handler)
│   └── off(type, handler)
├── Transport adapters
│   ├── MemoryTransport
│   ├── FileTransport
│   └── ExternalAdapter pattern
├── Diagnostics
│   ├── GET /diagnostics
│   ├── store health
│   └── event summary
├── Logging
│   ├── JSON structured logs
│   ├── component field
│   └── event field
├── Request IDs
│   ├── generate per request
│   └── return in response header
├── Test structure
│   ├── node --test
│   ├── MemoryStore isolation
│   ├── per-feature test files
│   └── assert-based assertions
└── Documentation conventions
    ├── docs/ARCHITECTURE.md
    ├── docs/GETTING_STARTED.md
    ├── docs/EVENTS.md
    └── README.md
```

## Keep Inside Switchboard Only

These are domain-specific and must not leak into the blueprint.

```text
domain/
├── gigs
├── venues
├── applications
├── contracts
├── payments
├── ratings
├── moderation rules
├── parent approval
└── marketplace scoring
```

The blueprint may include placeholder table names such as `entities`, `items`, `records`, but never `gigs`, `venues`, or `contracts`.

---

## Blueprint Output

The extracted blueprint lives in:

```text
protoforge/blueprints/application/
```

It contains:

- `src/` — framework modules with domain placeholders
- `public/` — shared frontend shell
- `tests/` — framework tests
- `docs/` — pattern documentation
- `package.json.template`
- `README.template.md`

## First Proof

The first generated application lives in:

```text
protoforge/examples/resonate/
```

It must be produced from the blueprint without editing Switchboard files. Its first scope is the empty organism: structure, config, persistence, repository, events, API skeleton, tests, docs.

## Verification Checklist

- [ ] `protoforge/blueprints/application/` has no Switchboard domain terms
- [ ] `protoforge/examples/resonate/` was generated from the blueprint
- [ ] `npm test` runs in `protoforge/examples/resonate/`
- [ ] Switchboard remains at `v1.0.0` and untouched
