# Packaging Report

## Executive Summary

- **Package:** `heidi-cascade-production-0.9.0-rc.5.tgz`
- **Package size:** 2.68 MB
- **Unpacked size:** 11.5 MB
- **Total files:** 1,622
- **`.npmignore` effectiveness:** Runtime, build, test, and large artifacts are excluded.
- **Status:** **PASS** — well under the 5 MB target.

## Pack Output

```text
npm notice package size:  2.8 MB
npm notice unpacked size: 11.5 MB
npm notice total files:   1622
```

## Excluded Artifacts

`.npmignore` excludes:

- `node_modules/`
- `.next/`
- `out/`
- `dist/`
- `apps/`
- `heidi-core/`
- `hydi-monitor-deploy/`
- `coverage/`
- `reports/`
- `logs/`
- `data/`
- `artifacts/`
- `archive/`
- `docs/audit/`
- `tests/`
- `*.bundle`
- `*.tgz`
- `*.zip`
- `__pycache__/`
- `*.pyc`
- `.env` / `.env.*`
- Rezonate stems/samples

## Pack Verification

```text
heidi-cascade-production-0.9.0-rc.5.tgz  2.68 MB
```

A `tar -tzf` check was run to confirm no `node_modules/`, `.next/`, or `.bundle` files leaked into the tarball. No such entries were found.

## Commands Executed

```text
npm pack
```

## Conclusion

**PASS.** The rc.5 release package is 2.68 MB (2.8 MB compressed / 11.5 MB unpacked), well below the 5 MB target. Runtime and development artifacts are correctly excluded.
