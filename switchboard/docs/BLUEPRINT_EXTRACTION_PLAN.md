# Switchboard ProtoForge Blueprint Extraction Plan

## Principle

A ProtoForge blueprint is extracted from a stable reference implementation, not invented from assumptions. Switchboard is now the first stable reference. This plan describes how to extract it.

## Extraction Boundary

### Framework Patterns — Reusable

These layers and conventions become the blueprint:

- **Project structure**: `src/`, `public/`, `docs/`, `tests/`, `data/`
- **API layer**: Express setup, route wiring, centralized error handling
- **Persistence layer**: `Store` interface, `JsonStore`, `MemoryStore`, schema migrations, atomic writes
- **Repository layer**: validated CRUD, auditing, one-event-per-mutation
- **Event system**: `EventBus`, `MemoryTransport`, `FileTransport`, external adapter pattern
- **Configuration**: env-driven config with typed helpers and defaults
- **Validation**: synchronous input validation helpers
- **Error handling**: domain error classes, middleware mapping
- **Logging**: JSON logger with component and event fields
- **Middleware**: request IDs, rate limiting, structured errors
- **Diagnostics**: health endpoint and report format
- **Testing**: `node --test` file layout, `MemoryStore` isolation
- **Documentation**: feature docs, weekly reports, release audits

### Domain Logic — Not Reusable

Switchboard-specific logic stays in the app, not the blueprint:

- Users, age protection, parent approval
- Gigs, venues, skills, budgets
- Applications, ranking, scoring
- Contracts, payments, ratings
- Moderation cases and statuses
- Availability profiles and exceptions
- Marketplace rules

## Extraction Steps

1. **Create a new repository** or template directory called `protoforge-blueprint/`.
2. **Copy the framework skeleton** without domain code:
   - `src/api.js` → keep middleware and route structure, remove specific routes
   - `src/repository.js` → keep `Repository` class and `createRepository`, remove domain methods
   - `src/persistence/` → copy as-is
   - `src/events/` → copy `EventBus`, `MemoryTransport`, `FileTransport`, adapter pattern
   - `src/config.js` → keep structure, add placeholder keys
   - `src/errors.js`, `src/logger.js`, `src/middleware.js`, `src/validation.js` → copy
   - `public/styles.css`, `public/ui.js` → copy
   - `tests/` → create minimal starter tests
   - `docs/` → create `GETTING_STARTED.md`, `ARCHITECTURE.md`, `EVENTS.md`
3. **Replace Switchboard terms** with blueprint comments:
   - `/* DEFINE_YOUR_DOMAIN_TABLES_HERE */`
   - `/* ADD_YOUR_DOMAIN_METHODS_HERE */`
4. **Provide a `setup.sh` or `package.json` template** that installs the same deps:
   - `express`
   - `bcryptjs`
   - `node` >= 18
5. **Version the blueprint as `protoforge-blueprint@1.0.0`**, referencing Switchboard v1.0.0 as its source reference.

## Blueprint Template Repository Layout

```text
protoforge-blueprint/
├── README.md
├── package.json
├── setup.sh
├── src/
│   ├── api.js
│   ├── config.js
│   ├── errors.js
│   ├── logger.js
│   ├── middleware.js
│   ├── repository.js
│   ├── validation.js
│   ├── index.js
│   ├── persistence/
│   │   ├── store.js
│   │   ├── json-store.js
│   │   └── memory-store.js
│   └── events/
│       ├── event-bus.js
│       ├── memory-transport.js
│       └── file-transport.js
├── public/
│   ├── styles.css
│   ├── ui.js
│   └── index.html
├── tests/
│   └── starter.test.js
└── docs/
    ├── ARCHITECTURE.md
    ├── EVENTS.md
    └── GETTING_STARTED.md
```

## Timing

Extract the blueprint only after:

- Switchboard v1.0.0 is tagged
- At least one additional ProtoForge app is ready to use it
- The reusable layers have proven their value without domain coupling

## Verification

A successful blueprint can be tested by creating a new app from it without copying any Switchboard domain code. If the new app can define its own tables, repository methods, and API routes while keeping the same structure and conventions, the extraction is correct.

## Notes

- Do not extract `docs/RC1_AUDIT.md`, `docs/V1_RELEASE_AUDIT.md`, or `docs/MODERATION_CONSOLE.md` as part of the blueprint. They are application history.
- Do not extract `public/app.js`, `public/moderation.html`, `public/availability.html`, etc. They are domain UIs.
- Keep the `HydiAdapter` pattern as an optional transport example, but replace the `switchboard.marketplace` capability with a template value.
