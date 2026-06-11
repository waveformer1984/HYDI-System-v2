# Wiring forge_runner.py → Heidi

Two steps. Five minutes.

## Step 1 — Copy the hook file

Copy `heidi_forge_hook.py` to `C:\ProtoForge_Ecosystem\` (same folder as forge_runner.py).

## Step 2 — Add three lines to forge_runner.py

Find the bottom of your main build cycle (after stage 9 Cleanup completes).
Add:

```python
# --- Heidi notification (add near the top of forge_runner.py) ---
import time as _time
_forge_start = _time.time()

# --- Add at the very end of the build cycle (after stage 9) ---
from heidi_forge_hook import notify_heidi
notify_heidi(
    build=build_number,          # your build counter variable
    status='success',
    cpu=cpu_percent,             # from your SysMonitor stage
    ram=ram_percent,
    disk=disk_percent,
    disk_free_gb=disk_free_gb,
    alerts=active_alerts,        # list of alert strings, or []
    duration_s=_time.time() - _forge_start,
)
```

**Variable names** — match whatever your forge_runner.py already uses.
The hook is zero-dependency (stdlib only) and never raises.

## What you'll see in Heidi

After every build, a push banner appears:

```
◈  Forge Build #547 — SUCCESS
   CPU 4% · RAM 61% · Disk 87% · 12.3s
```

Tap it to dismiss. The event also appears in the chat thread.

## Test without modifying forge_runner.py

Run this in PowerShell from C:\ProtoForge_Ecosystem\:

```powershell
python -c "
from heidi_forge_hook import notify_heidi
notify_heidi(build=999, status='success', cpu=4, ram=61, disk=87, disk_free_gb=57.1)
print('Sent.')
"
```

Check Heidi on your phone — the push banner should appear within 1 second.
