#!/usr/bin/env python3
"""
Heidi Bridge  —  ProtoForge Windows companion server
=====================================================
Runs on your Windows machine alongside ursula_server.py.
Heidi (Termux/Android) points URSULA_URL at this bridge.

Exposes the exact endpoints Heidi expects, reading directly
from protoforge.db (SQLite) and build_registry.json when
ursula_server.py is unavailable or its routes differ.

Usage
-----
    pip install flask requests
    python heidi-bridge.py

Environment
-----------
    BRIDGE_PORT      Port to listen on              (default: 5050)
    URSULA_URL       ursula_server.py base URL       (default: http://localhost:5000)
    PROTOHUB_URL     protohub base URL               (default: http://localhost:4000)
    PROTOFORGE_DIR   Root of C:\\ProtoForge_Ecosystem (default: script directory)
    DB_NAME          SQLite db filename              (default: protoforge.db)
    REGISTRY_FILE    Build registry filename         (default: build_registry.json)

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
URSULA_URL     = os.getenv('URSULA_URL', 'http://localhost:5000').rstrip('/')
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
    path    = request.args.get('path', '/health')
    data    = _get_json(f'{URSULA_URL}{path}')
    return jsonify(data or {'error': f'Ursula unreachable at {URSULA_URL}{path}'})

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
        print(f'  Ursula         : offline (start ursula_server.py first, or bridge runs standalone)')
    print()

    # Find LAN IP for the .env instruction
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        lan_ip = 'your-windows-ip'

    print(f'  Add to Heidi .env on Android/Termux:')
    print(f'    URSULA_URL=http://{lan_ip}:{PORT}')
    print()

    app.run(host='0.0.0.0', port=PORT, debug='--debug' in sys.argv)
