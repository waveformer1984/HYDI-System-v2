# Getting Started

## Install

```bash
npm install
```

## Run

```bash
npm start
```

## Test

```bash
npm test
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP port |
| `DATA_DIR` | `./data` | File storage directory |
| `DB_PATH` | `$DATA_DIR/db.json` | Database file |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Extend

- Add domain tables in `src/persistence/store.js`
- Add repository methods in `src/repository.js`
- Add API routes in `src/api/router.js`
- Document domain events in `docs/EVENTS.md`
