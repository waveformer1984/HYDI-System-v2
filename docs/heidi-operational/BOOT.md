# PM2 boot on Windows (Frank)

Heidi Phase 1 expects `heidi-core` and `heidi-web-standalone` to return after reboot without manual `npm run boot`.

## One-time setup on Frank

1. Open **PowerShell as Owner** in `C:\Users\Owner\HYDI-System-v2`.
2. Ensure deps: `npm ci` (or existing `node_modules`).
3. Start the declared PM2 apps (at minimum):

   ```powershell
   pm2 start ecosystem.config.js --only heidi-core,heidi-web-standalone,lifeline
   pm2 save
   ```

4. Register PM2 with Windows startup:

   ```powershell
   pm2 startup
   ```

   Run the command PM2 prints (often an `pm2.exe resurrect` scheduled task / service install). Then:

   ```powershell
   pm2 save
   ```

5. Confirm after a reboot (or `pm2 resurrect`):

   ```powershell
   pm2 ls
   curl http://127.0.0.1:3459/health
   curl http://127.0.0.1:3000/api/health
   ```

## Logs

- `heidi-core` PM2 logs: `C:\ProtoForge_Ecosystem\logs\pm2-heidi-core.*.log`
- Repo logs: `.\logs\` (Lifeline, lead digest markdown copies)

## Heartbeat verification

After Supabase is reachable and migration `20261113000000_heidi_state_snapshots` is applied:

```sql
SELECT captured_at, payload->>'ts' AS ts, source
FROM heidi_state_snapshots
WHERE source = 'operational-heartbeat'
ORDER BY captured_at DESC
LIMIT 5;
```

**DONE_TEST (48h):** no gap longer than 20 minutes between rows.