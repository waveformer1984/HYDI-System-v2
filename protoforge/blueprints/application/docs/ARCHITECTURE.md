# Application Blueprint Architecture

## Layers

```text
Frontend (public/)
        ↓
    API (src/api/router.js)
        ↓
    Repository (src/repository.js)
        ↓
    Store (src/persistence/)
        ↓
    JSON file / memory

    EventBus (src/events/event-bus.js)
        ↓
    Transports (Memory, File, External)
```

## Module Responsibilities

- `src/api/router.js` — Express app, routes, request IDs, error handling
- `src/repository.js` — validated CRUD, event emission, logging
- `src/persistence/` — `Store` interface, `JsonStore`, `MemoryStore`
- `src/events/event-bus.js` — `EventBus`, `MemoryTransport`, `FileTransport`, `ExternalAdapter`
- `src/validation.js` — input validation helpers
- `src/config.js` — env-driven configuration
- `src/errors.js` — domain error classes
- `src/logger.js` — structured JSON logging

## Extending

Replace the `Record` placeholder with your domain. Keep the layer contracts.
