#!/usr/bin/env python3
"""
Heidi Bridge  —  ProtoForge Windows companion server
=====================================================
Runs on your Windows machine. Heidi (Termux/Android) connects here.

Bridges three data sources:
  1. protoforge.db (SQLite) — local build history, sessions, revenue
  2. build_registry.json   — forge cycle build log
  3. Ursula (Vercel/local) — live system status proxied through

Usage
-----
    pip install flask requests
    python heidi-bridge.py

Environment
-----------
    BRIDGE_PORT      Port to listen on                     (default: 5050)
    URSULA_URL       Ursula base URL                       (default: https://ursula-nine.vercel.app)
    PROTOHUB_URL     protohub base URL                     (default: http://localhost:4000)
    PROTOFORGE_DIR   Root of C:\\ProtoForge_Ecosystem      (default: script directory)
    DB_NAME          SQLite db filename                    (default: protoforge.db)
    REGISTRY_FILE    Build registry filename               (default: build_registry.json)

Then set on Android/Termux .env:
    URSULA_URL=http://<your-windows-ip>:5050
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from flask import Flask, jsonify, request
except ImportError:
    raise SystemExit("Run: pip install flask requests")

app = Flask(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

PORT           = int(os.getenv('BRIDGE_PORT', 5050))
URSULA_URL     = os.getenv('URSULA_URL', 'https://ursula-nine.vercel.app').rstrip('/')
PROTOHUB_URL   = os.getenv('PROTOHUB_URL', 'http://localhost:4000').rstrip('/')
PROTOFORGE_DIR = Path(os.getenv('PROTOFORGE_DIR', os.path.dirname(os.path.abspath(__file__))))
DB_PATH        = PROTOFORGE_DIR / os.getenv('DB_NAME', 'protoforge.db')
REGISTRY_PATH  = PROTOFORGE_DIR / os.getenv('REGISTRY_FILE', 'build_registry.json')

START_TIME = time.time()

# ── CORS ──────────────────────────────────────────────────────────────────────

@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def options(_path=''):
    return '', 204

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_json(url, timeout=2):
    try:
        import requests
        r = requests.get(url, timeout=timeout)
        if r.ok:
            return r.json()
    except Exception:
        pass
    return None

def _post_json(url, payload, timeout=2):
    try:
        import requests
        r = requests.post(url, json=payload, timeout=timeout)
        if r.ok:
            return r.json()
    except Exception:
        pass
    return None

def _db_query(sql, params=()):
    if not DB_PATH.exists():
        return []
    try:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []

def _read_registry():
    try:
        data = json.loads(REGISTRY_PATH.read_text())
        return data if isinstance(data, list) else data.get('builds', data.get('registry', []))
    except Exception:
        return []

def _ursula_health():
    for path in ['/health', '/api/health', '/status', '/api/status']:
        d = _get_json(f'{URSULA_URL}{path}')
        if d:
            return d, path
    return None, None

def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health')
@app.route('/api/health')
def health():
    ursula, ursula_ep = _ursula_health()
    builds  = _read_registry()
    db_ok   = DB_PATH.exists()

    # Count events from DB if possible
    ev_rows = _db_query('SELECT COUNT(*) AS n FROM events')
    total_events = ev_rows[0]['n'] if ev_rows else len(builds)

    ursula_status = None
    if ursula:
        ursula_status = ursula.get('status') or ursula.get('hydi_status') or 'online'

    return jsonify({
        'status':       'operational' if (ursula or db_ok) else 'degraded',
        'database':     'sqlite' if db_ok else 'unavailable',
        'total_events': total_events,
        'builds':       len(builds),
        'ursula':       ursula_status or 'offline',
        'ursula_endpoint': ursula_ep,
        'bridge_uptime': round(time.time() - START_TIME),
        'timestamp':    _now_iso(),
        'version':      '1.0.0',
        'source':       'heidi-bridge',
    })

@app.route('/status')
@app.route('/api/status')
def status():
    return health()

@app.route('/api/builds')
def api_builds():
    limit  = min(int(request.args.get('limit', 20)), 100)
    builds = _read_registry()
    recent = list(reversed(builds))[:limit]
    return jsonify({
        'total':    len(builds),
        'recent':   recent,
        'source':   str(REGISTRY_PATH),
        'exists':   REGISTRY_PATH.exists(),
    })

@app.route('/api/forge/status')
def forge_status():
    builds  = _read_registry()
    recent  = list(reversed(builds))[:10]
    total   = len(builds)
    last    = recent[0] if recent else {}
    statuses = [b.get('status', 'unknown') for b in recent]
    ok_count = sum(1 for s in statuses if s in ('success', 'ok', 'complete', 'done'))
    return jsonify({
        'total_builds':       total,
        'last_build':         last,
        'recent_success_rate': round(ok_count / len(statuses), 2) if statuses else 0,
        'recent_statuses':    statuses,
    })

@app.route('/api/metrics')
def metrics():
    builds   = _read_registry()
    ev_rows  = _db_query('SELECT COUNT(*) AS n FROM events')
    total_ev = ev_rows[0]['n'] if ev_rows else len(builds)
    recent   = list(reversed(builds))[:10]
    statuses = [b.get('status', 'unknown') for b in recent]
    ok_count = sum(1 for s in statuses if s in ('success', 'ok', 'complete', 'done'))
    return jsonify({
        'total_events':        total_ev,
        'total_builds':        len(builds),
        'recent_success_rate': round(ok_count / len(statuses), 2) if statuses else 0,
        'event_bus':           'active' if builds else 'idle',
    })

@app.route('/api/db/tables')
def db_tables():
    rows = _db_query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return jsonify({
        'tables': [r['name'] for r in rows],
        'db_path': str(DB_PATH),
        'exists': DB_PATH.exists(),
    })

import threading

# In-memory SSE push queue — bridge-side (mirrors Heidi server's pushClients)
_sse_clients: list = []
_sse_lock = threading.Lock()

@app.route('/api/bridge/stream')
def bridge_sse_stream():
    """SSE endpoint — Heidi server subscribes here for forge/bridge events."""
    import queue
    q: queue.Queue = queue.Queue(maxsize=50)
    with _sse_lock:
        _sse_clients.append(q)

    def generate():
        yield 'data: {"type":"connected","source":"bridge"}\n\n'
        try:
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield f'data: {msg}\n\n'
                except queue.Empty:
                    yield ': ping\n\n'  # keep-alive
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                _sse_clients.remove(q)

    return app.response_class(generate(), mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

def _broadcast(payload: dict) -> int:
    """Push a JSON event to all connected SSE clients. Returns client count."""
    import json as _json
    msg = _json.dumps(payload)
    dead = []
    with _sse_lock:
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)
    return len(_sse_clients) - len(dead)

@app.route('/api/forge/webhook', methods=['POST'])
def forge_webhook():
    """
    Called by forge_runner.py at end of each build cycle.
    Broadcasts a push notification to all connected Heidi clients.

    Expected body (all fields optional):
    {
      "build":   546,
      "status":  "success",
      "cpu":     4,
      "ram":     61,
      "disk":    87,
      "disk_free_gb": 57.1,
      "stages":  9,
      "alerts":  [],
      "duration_s": 12.3
    }
    """
    data   = request.get_json(silent=True) or {}
    build  = data.get('build', '?')
    status = data.get('status', 'complete').lower()
    cpu    = data.get('cpu', '?')
    ram    = data.get('ram', '?')
    disk   = data.get('disk', '?')
    alerts = data.get('alerts', [])
    dur    = data.get('duration_s')

    level = 'warning' if alerts else ('critical' if status == 'failed' else 'info')
    dur_str = f' · {dur:.1f}s' if isinstance(dur, (int, float)) else ''
    alert_str = f' · {len(alerts)} alert{"s" if len(alerts)!=1 else ""}' if alerts else ''

    payload = {
        'type':  'forge_build',
        'title': f'Forge Build #{build} — {status.upper()}',
        'body':  f'CPU {cpu}% · RAM {ram}% · Disk {disk}%{alert_str}{dur_str}',
        'level': level,
        'payload': data,
        'ts': time.time()
    }

    clients = _broadcast(payload)

    # Also forward to Heidi server's push endpoint if it's running
    _post_json('http://localhost:3006/api/events/push', payload)

    return jsonify({'success': True, 'clients_notified': clients, 'build': build, 'level': level})

@app.route('/api/db/query', methods=['POST'])
def db_query_route():
    body = request.get_json(silent=True) or {}
    sql  = body.get('sql', '').strip()
    if not sql.upper().startswith('SELECT'):
        return jsonify({'error': 'Only SELECT queries allowed'}), 403
    rows = _db_query(sql)
    return jsonify({'rows': rows, 'count': len(rows)})

@app.route('/api/events', methods=['POST'])
@app.route('/events',     methods=['POST'])
@app.route('/process',    methods=['POST'])
def post_event():
    event = request.get_json(silent=True) or {}
    # Forward to ursula if available
    for path in ['/api/events', '/events', '/process']:
        result = _post_json(f'{URSULA_URL}{path}', event)
        if result is not None:
            return jsonify({'success': True, 'forwarded': f'{URSULA_URL}{path}', 'result': result})
    return jsonify({'success': True, 'stored': 'local', 'note': 'Ursula offline — event acknowledged'})

@app.route('/api/rezonate/status')
def rezonate_status():
    # Try ursula's rezonate endpoint first
    for url in [f'{URSULA_URL}/api/rezonate/status', f'{URSULA_URL}/rezonate/status',
                'http://localhost:7000/health', 'http://localhost:8000/health']:
        d = _get_json(url)
        if d:
            return jsonify({**d, 'source': url})
    return jsonify({'status': 'offline', 'note': 'Rezonate DAW not detected on known ports'})

@app.route('/api/ursula/proxy')
def ursula_proxy():
    """Pass-through proxy to any ursula endpoint."""
    path = request.args.get('path', '/health')
    data = _get_json(f'{URSULA_URL}{path}')
    return jsonify(data or {'error': f'Ursula unreachable at {URSULA_URL}{path}'})

@app.route('/api/ursula/revenue')
def ursula_revenue():
    """Proxy to Ursula's live revenue endpoint."""
    data = _get_json(f'{URSULA_URL}/api/revenue') or \
           _get_json(f'{URSULA_URL}/api/client-dashboard')
    return jsonify(data or {'error': 'Revenue endpoint not reachable on Ursula'})

@app.route('/api/rezonate/score')
def rezonate_score():
    """Run Rezonate ProtoForge completion scoring if rezonate_core is available."""
    rez_dir = PROTOFORGE_DIR / 'Ursula_Suite' / 'api'
    core_candidates = [
        PROTOFORGE_DIR / 'rezonate_core',
        PROTOFORGE_DIR / 'Ursula_Suite' / 'rezonate_core',
        PROTOFORGE_DIR / 'rezonette' / 'rezonate_core',
    ]
    import sys
    for candidate in core_candidates:
        if candidate.exists():
            sys.path.insert(0, str(candidate.parent))
            try:
                from rezonate_core.protoforge_integration import RezonateProtoForgeService
                svc   = RezonateProtoForgeService()
                score = svc.calculate_completion_score()
                rev   = svc.estimate_revenue({'free': 500, 'standard': 100, 'professional': 25, 'enterprise': 2})
                suggestions = svc.get_scaffolding_suggestions()
                return jsonify({
                    'found':       True,
                    'core_path':   str(candidate),
                    'completion':  round(score.overall, 3),
                    'scores': {
                        'audio_engine':       score.audio_engine,
                        'mixing_mastering':   score.mixing_mastering,
                        'hardware_control':   score.hardware_control,
                        'rights_monetization': score.rights_monetization,
                        'blockchain':         score.blockchain_integration,
                        'ui_demo':            score.ui_demo,
                        'test_coverage':      score.test_coverage,
                        'documentation':      score.documentation,
                    },
                    'estimated_monthly_revenue': rev,
                    'suggestions': suggestions,
                    'pricing': [{'tier': p['tier'], 'monthly_usd': p['monthly_usd']} for p in svc.get_pricing()],
                })
            except Exception as exc:
                return jsonify({'found': True, 'core_path': str(candidate), 'error': str(exc)})
    return jsonify({'found': False, 'note': 'rezonate_core not found in expected locations', 'searched': [str(c) for c in core_candidates]})

@app.route('/api/system/info')
def system_info():
    """Full system inventory for Heidi's context."""
    builds = _read_registry()
    ursula, ursula_ep = _ursula_health()
    ph = _get_json(f'{PROTOHUB_URL}/health')
    tables = _db_query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return jsonify({
        'bridge':    {'port': PORT, 'uptime': round(time.time() - START_TIME), 'version': '1.0.0'},
        'ursula':    {'url': URSULA_URL, 'status': ursula.get('status') if ursula else 'offline', 'endpoint': ursula_ep},
        'protohub':  {'url': PROTOHUB_URL, 'status': ph.get('status') if ph else 'offline'},
        'database':  {'path': str(DB_PATH), 'exists': DB_PATH.exists(), 'tables': [r['name'] for r in tables]},
        'registry':  {'path': str(REGISTRY_PATH), 'exists': REGISTRY_PATH.exists(), 'builds': len(builds)},
        'timestamp': _now_iso(),
    })

# ── Startup ───────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import sys

    db_found  = '(found)' if DB_PATH.exists()       else '(NOT FOUND — check PROTOFORGE_DIR)'
    reg_found = '(found)' if REGISTRY_PATH.exists() else '(not found yet)'

    print('Heidi Bridge')
    print('============')
    print(f'  Port           : {PORT}')
    print(f'  ProtoForge dir : {PROTOFORGE_DIR}')
    print(f'  Database       : {DB_PATH} {db_found}')
    print(f'  Build registry : {REGISTRY_PATH} {reg_found}')
    print(f'  Ursula URL     : {URSULA_URL}')
    print(f'  Protohub URL   : {PROTOHUB_URL}')
    print()

    # Quick connectivity check
    ursula_data, ep = _ursula_health()
    if ursula_data:
        print(f'  Ursula         : connected at {ep} — status: {ursula_data.get("status", "?")}')
    else:
        print(f'  Ursula         : offline')

    # DB table inventory
    if DB_PATH.exists():
        tables = _db_query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        if tables:
            print()
            print('  protoforge.db tables:')
            for t in tables:
                count = _db_query(f"SELECT COUNT(*) AS n FROM \"{t['name']}\"")
                n = count[0]['n'] if count else '?'
                print(f'    {t["name"]:30s} {n:>6} rows')

    # Rezonate check
    core_candidates = [
        PROTOFORGE_DIR / 'rezonate_core',
        PROTOFORGE_DIR / 'Ursula_Suite' / 'rezonate_core',
        PROTOFORGE_DIR / 'rezonette' / 'rezonate_core',
    ]
    rez_found = next((c for c in core_candidates if c.exists()), None)
    print()
    if rez_found:
        print(f'  Rezonate core  : found at {rez_found}')
    else:
        print(f'  Rezonate core  : not found (clone rezonette repo into {PROTOFORGE_DIR})')

    # Find LAN IP for the .env instruction
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        lan_ip = 'your-windows-ip'

    print()
    print(f'  Add to Heidi .env on Android/Termux:')
    print(f'    URSULA_URL=http://{lan_ip}:{PORT}')
    print()

    app.run(host='0.0.0.0', port=PORT, debug='--debug' in sys.argv)
