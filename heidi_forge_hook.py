"""
heidi_forge_hook.py  —  drop-in notifier for forge_runner.py
=============================================================
Add one line at the end of your forge_runner.py build cycle:

    from heidi_forge_hook import notify_heidi
    notify_heidi(build=build_number, status="success", cpu=cpu, ram=ram,
                 disk=disk, disk_free_gb=disk_free, alerts=alerts, duration_s=elapsed)

Or call it with just the basics:

    from heidi_forge_hook import notify_heidi
    notify_heidi(build=build_number)

The hook is fire-and-forget — it never raises, never blocks your build.
"""

import time
import os

BRIDGE_URL = os.getenv('HEIDI_BRIDGE_URL', 'http://localhost:5050')

def notify_heidi(
    build=None,
    status='success',
    cpu=None,
    ram=None,
    disk=None,
    disk_free_gb=None,
    alerts=None,
    duration_s=None,
    extra=None,
):
    """
    POST build completion data to heidi-bridge.py.
    Non-blocking, swallows all errors.
    """
    payload = {
        'build':        build,
        'status':       status,
        'cpu':          cpu,
        'ram':          ram,
        'disk':         disk,
        'disk_free_gb': disk_free_gb,
        'alerts':       alerts or [],
        'duration_s':   duration_s,
        'source':       'forge_runner',
        'ts':           time.time(),
    }
    if extra:
        payload.update(extra)

    # Strip None values
    payload = {k: v for k, v in payload.items() if v is not None}

    try:
        import urllib.request, json
        body = json.dumps(payload).encode()
        req  = urllib.request.Request(
            f'{BRIDGE_URL}/api/forge/webhook',
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Never interrupt the build
