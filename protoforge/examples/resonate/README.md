# Resonate

A ProtoForge-generated application. Resonate is the first proof that the blueprint can produce an independent organism.

## Quick Start

```bash
npm install
npm test
npm start
```

Then open `http://localhost:3000`.

## Structure

- `src/api/` — HTTP routes
- `src/repository.js` — validated domain persistence
- `src/persistence/` — storage backends
- `src/events/` — domain event bus and transports
- `src/validation.js` — input validation
- `src/config.js` — configuration
- `src/errors.js` — domain errors
- `src/logger.js` — structured logging

## Notes

Resonate is currently a healthy empty organism generated from `protoforge/blueprints/application/`. Domain behavior will be added in a later phase.
