# Ursula Report

## Executive Summary

- **`ursula-postgres`:** Healthy.
- **`ursula` database:** Created successfully on `ursula-postgres` using the `ursula` user.
- **`ursula-flask`:** Still in a restart loop due to a **Python import error**, not the missing database.

## Root Cause

The `ursula-flask` container was failing with two errors:

1. `FATAL: database "ursula" does not exist` — **FIXED** by running `createdb` and restarting.
2. `ImportError: cannot import name 'BlameGames' from 'blame_games' (unknown location)` — **UNRESOLVED**; this is a code-level defect in the Ursula Flask image.

## Investigation

### Container image inspection

```text
docker run --rm --entrypoint sh ursula_suite-flask-backend -c 'find /app -name "*blame*" -o -name "*game*"'
```

Result:

```text
/app/apps/blame_games
/app/apps/blame_games/__pycache__/blame_games.cpython-310.pyc
/app/apps/blame_games/__pycache__/blame_games.cpython-313.pyc
/app/apps/blame_games/blame_games.py
```

### Findings

- The `blame_games` package has a directory and a `blame_games.py` file, but **no `__init__.py`**.
- Without `__init__.py`, `from blame_games import BlameGames` cannot resolve.
- Additionally, `/app/apps` may not be on `PYTHONPATH`.

## Actions Taken

1. Created the missing `ursula` database:

```text
docker exec -e PGPASSWORD=password ursula-postgres createdb -U ursula -h 127.0.0.1 ursula
```

2. Restarted `ursula-flask`:

```text
docker restart ursula-flask
```

## Result

- The `database "ursula" does not exist` FATAL errors stopped.
- The `ImportError: cannot import name 'BlameGames' from 'blame_games'` remains.
- Container status: `Restarting (1) 55 seconds ago`.

## Recommended Fix

The Ursula Flask image needs one of the following:

1. Add `/app/apps/blame_games/__init__.py` that exports `BlameGames` from `blame_games.py`:

```python
from .blame_games import BlameGames
```

2. Ensure `PYTHONPATH` includes `/app/apps`.

## Commands Executed

```text
docker logs ursula-flask --tail 30
docker logs ursula-postgres --tail 30
docker inspect --format='{{.Config.Env}}' ursula-postgres
docker exec -e PGPASSWORD=password ursula-postgres createdb -U ursula -h 127.0.0.1 ursula
docker restart ursula-flask
docker run --rm --entrypoint sh ursula_suite-flask-backend -c 'find /app -name "*blame*" -o -name "*game*"'
```

## Conclusion

**PARTIAL PASS.** The missing `ursula` database has been created, which resolved one failure mode. However, `ursula-flask` cannot start because of an import-path defect in the Ursula Flask image (`blame_games` package missing `__init__.py`). This is a non-HYDI companion service and does not block the `heidi-cascade-production` v0.9.0-rc.5 qualification, which has already passed.
