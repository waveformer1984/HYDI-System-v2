# Sample App

A ProtoForge-generated application. This is a healthy empty organism generated from `protoforge/blueprints/application/`.

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

This sample app was renamed from `protoforge/examples/resonate/` to avoid collision with the canonical Resonate product.
