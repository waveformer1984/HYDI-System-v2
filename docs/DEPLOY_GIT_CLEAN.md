# Clean tree for frank-auto-deploy

`frank-auto-deploy` refuses to fast-forward when `git status --porcelain` is non-empty on `clean-main`.

## One-time cleanup on Frank

```powershell
cd C:\Users\Owner\HYDI-System-v2
git checkout clean-main
git pull origin clean-main
git stash push -u -m "pre-deploy tracked-tree cleanup"
git status --porcelain   # expect empty
npm run runtime:audit
```

Do not drop the stash until you confirm nothing important was only on disk.

## Where PM2 may write

All long-lived status files must live under `.gitignore` paths (see `tests/unit/ecosystem-writes-gitignore.test.js`). If a new worker writes at repo root, add the path to `.gitignore` or move it under `.runtime/`.
