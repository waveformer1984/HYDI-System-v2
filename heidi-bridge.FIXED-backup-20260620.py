#!/usr/bin/env python3
"""
Heidi Bridge  --  ProtoForge Windows companion server
=====================================================
Runs on your Windows machine. Heidi (Termux/Android) connects here.

Bridges three data sources:
  1. protoforge.db (SQLite) -- local build history, sessions, revenue
  2. build_registry.json   -- forge cycle build log
  3. Ursula (Vercel/local) -- live system status proxied through

Usage
-----
    pip install flask requests
    python heidi-bridge.py

Environment
-----------
    BRIDGE_PORT      Port to listen on                     (default: 5050)
    URSULA_URL       Ursula base URL                       (default: https://ursula-nine.vercel.app)
    PROTOHUB_URL     protohub base URL                     (default: http://localhost:4000)
    PROTOFORGE_DIR   Root of C:\ProtoForge_Ecosystem      (default: script directory)
    DB_NAME          SQLite db filename                    (default: protoforge.db)
    REGISTRY_FILE    Build registry filename               (default: build_registry.json)

Then set on Android/Termux .env:
    URSULA_URL=http://<your-windows-ip>:5050
"""

import json
import os
import sqlite3
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from flask import Flask, jsonify, request
except ImportError:
    raise SystemExit("Run: pip install flask requests")

app = Flask(__name__)

try:
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from memory.semantic_memory import SemanticMemory
except Exception:
    SemanticMemory = None

try:
    from agents.router import route_task, list_agents
except Exception:
    route_task = None
    list_agents = None

try:
    from agents.handlers import dispatch, dispatch_task
except Exception:
    dispatch = None
    dispatch_task = None

try:
    from memory.reflect import run_reflection_cycle, _ursula_summary
except Exception:
    run_reflection_cycle = None
    _ursula_summary = None

try:
    from agents.handlers import MEMORY_MATRIX_PATH
except Exception:
    MEMORY_MATRIX_PATH = None

try:
    from monitoring.thresholds import (
        get_thresholds, evaluate_metrics, current_status,
        recent_alerts, alert_summary,
    )
except Exception:
    get_thresholds = None
    evaluate_metrics = None
    current_status = None
    recent_alerts = None
    alert_summary = None

try:
    from memory.decision_loop import run_decision_loop
except Exception:
    run_decision_loop = None

# -- Config -----------------------------------------------------------------

# Phase 5.3: paths/URLs now live in config.py (imported as plain names so
# existing `monkeypatch.setattr(<this module>, 'DB_PATH', ...)`-style test
# fixtures continue to work unchanged).
from config import PROTOFORGE_DIR, DB_PATH, REGISTRY_PATH, URSULA_URL, PROTOHUB_URL  # noqa: E402

PORT = int(os.getenv('BRIDGE_PORT', 5050))

# Phase 3.3: optional LLM-backed /api/ask synthesis. Off by default (no
# ANTHROPIC_API_KEY -> _llm_answer always returns None and /api/ask falls
# back to a templated answer built from the routing/dispatch result).
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
LLM_ASK_MODEL = os.getenv('HEIDI_ASK_MODEL', 'claude-haiku-4-5-20251001')

START_TIME = time.time()

# -- CORS ---------------------------------------------------------------------

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

# -- Global error handler -----------------------------------------------------
# Surface real errors as JSON (with traceback) instead of opaque HTML 500s,
# so Heidi (and we) can see exactly what went wrong.
@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    return jsonify({
        'error': str(e),
        'type': type(e).__name__,
        'traceback': traceback.format_exc(),
    }), 500

# -- Helpers --------------------------------------------------------------------

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
    """Build records as a list. The registry file may instead store only a
    summarized count (e.g. {"builds": 1507}); in that form there are no
    per-build records to return, so this yields [] -- callers that need the
    total should use _registry_count()."""
    try:
        data = json.loads(REGISTRY_PATH.read_text())
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            val = data.get('builds', data.get('registry', []))
            return val if isinstance(val, list) else []
        return []
    except Exception:
        return []

def _registry_count():
    """Total number of builds, honoring both registry forms: a list of build
    records, or a summarized integer count (e.g. {"builds": 1507})."""
    try:
        data = json.loads(REGISTRY_PATH.read_text())
        if isinstance(data, list):
            return len(data)
        if isinstance(data, dict):
            val = data.get('builds', data.get('registry', []))
            if isinstance(val, bool):
                return 0
            if isinstance(val, int):
                return val
            if isinstance(val, list):
                return len(val)
        return 0
    except Exception:
        return 0

def _ursula_health():
    # Guard: if URSULA_URL points back at this bridge's own port, probing it
    # would make /health call itself recursively (-> thread/recursion exhaustion).
    if f':{PORT}' in URSULA_URL:
        return None, None
    for path in ['/health', '/api/health', '/status', '/api/status']:
        d = _get_json(f'{URSULA_URL}{path}')
        # Only accept a proper dict; a non-dict body would break ursula.get(...).
        if isinstance(d, dict):
            return d, path
    return None, None

def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def _llm_answer(question, routed, result):
    """
    Phase 3.3: optionally synthesize a natural-language answer to `question`
    given the agent it was routed to (`routed`) and the dispatch `result`.

    Returns the synthesized string, or None if ANTHROPIC_API_KEY is unset,
    the request fails, or the response is empty -- callers should fall back
    to a templated answer built from `routed`/`result` in that case.
    """
    if not ANTHROPIC_API_KEY:
        return None
    try:
        prompt = (
            "A user asked the ProtoForge/Heidi system the question below. "
            "It was routed to an agent, which produced a result. Write a "
            "short, friendly 1-3 sentence answer for the user based on the "
            "result. Do not invent facts not present in the result.\n\n"
            f"Question: {question}\n"
            f"Routed to: {routed.get('agent')} ({routed.get('role')})\n"
            f"Result: {json.dumps(result, default=str)}"
        )
        body = json.dumps({
            'model': LLM_ASK_MODEL,
            'max_tokens': 250,
            'messages': [{'role': 'user', 'content': prompt}],
        }).encode('utf-8')
        req = urllib.request.Request(
            ANTHROPIC_API_URL,
            data=body,
            headers={
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        answer = ''
        for block in data.get('content', []):
            if block.get('type') == 'text':
                answer += block.get('text', '')
        answer = answer.strip()
        return answer or None
    except Exception:
        return None

# -- Routes ---------------------------------------------------------------------

@app.route('/health')
@app.route('/api/health')
def health():
    ursula, ursula_ep = _ursula_health()
    build_count = _registry_count()
    db_ok   = DB_PATH.exists()

    # Count events from DB if possible
    ev_rows = _db_query('SELECT COUNT(*) AS n FROM events')
    total_events = ev_rows[0]['n'] if ev_rows else build_count

    ursula_status = None
    if ursula:
        ursula_status = ursula.get('status') or ursula.get('hydi_status') or 'online'

    return jsonify({
        'status':       'operational' if (ursula or db_ok) else 'degraded',
        'database':     'sqlite' if db_ok else 'unavailable',
        'total_events': total_events,
        'builds':       build_count,
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
        'total':    _registry_count(),
        'recent':   recent,
        'source':   str(REGISTRY_PATH),
        'exists':   REGISTRY_PATH.exists(),
    })

@app.route('/api/forge/status')
def forge_status():
    builds  = _read_registry()
    recent  = list(reversed(builds))[:10]
    total   = _registry_count()
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
    total_ev = ev_rows[0]['n'] if ev_rows else _registry_count()
    recent   = list(reversed(builds))[:10]
    statuses = [b.get('status', 'unknown') for b in recent]
    ok_count = sum(1 for s in statuses if s in ('success', 'ok', 'complete', 'done'))
    return jsonify({
        'total_events':        total_ev,
        'total_builds':        _registry_count(),
        'recent_success_rate': round(ok_count / len(statuses), 2) if statuses else 0,
        'event_bus':           'active' if _registry_count() else 'idle',
    })

@app.route('/api/monitoring/thresholds')
def monitoring_thresholds():
    """Return the centralized alert threshold configuration."""
    if get_thresholds is None:
        return jsonify({'error': 'monitoring module unavailable'}), 503
    return jsonify({'thresholds': get_thresholds()})

@app.route('/api/monitoring/status')
def monitoring_status():
    """Evaluate the most recent telemetry sample against the thresholds."""
    if current_status is None:
        return jsonify({'error': 'monitoring module unavailable'}), 503
    return jsonify(current_status())

@app.route('/api/alerts')
def alerts():
    """Recent alerts from the alerts table, plus a severity/metric summary."""
    if recent_alerts is None or alert_summary is None:
        return jsonify({'error': 'monitoring module unavailable'}), 503
    limit = min(int(request.args.get('limit', 20)), 200)
    severity = request.args.get('severity')
    return jsonify({
        'alerts': recent_alerts(limit=limit, severity=severity),
        'summary': alert_summary(),
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

# In-memory SSE push queue -- bridge-side (mirrors Heidi server's pushClients)
_sse_clients: list = []
_sse_lock = threading.Lock()

@app.route('/api/bridge/stream')
def bridge_sse_stream():
    """SSE endpoint -- Heidi server subscribes here for forge/bridge events."""
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
    dur_str = f' . {dur:.1f}s' if isinstance(dur, (int, float)) else ''
    alert_str = f' . {len(alerts)} alert{"s" if len(alerts)!=1 else ""}' if alerts else ''

    payload = {
        'type':  'forge_build',
        'title': f'Forge Build #{build} -- {status.upper()}',
        'body':  f'CPU {cpu}% . RAM {ram}% . Disk {disk}%{alert_str}{dur_str}',
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
    return jsonify({'success': True, 'stored': 'local', 'note': 'Ursula offline -- event acknowledged'})

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

@app.route('/api/memory/add', methods=['POST'])
def memory_add():
    """Store a memory (text + optional source/tags/metadata) for later semantic search."""
    if SemanticMemory is None:
        return jsonify({'error': 'semantic memory module unavailable'}), 503
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'text is required'}), 400
    mem = SemanticMemory(DB_PATH)
    mem_id = mem.add(
        text=text,
        source=data.get('source'),
        tags=data.get('tags'),
        metadata=data.get('metadata'),
    )
    return jsonify({'id': mem_id, 'stored': True})

@app.route('/api/memory/search')
def memory_search():
    """Search stored memories by semantic (cosine) similarity to ?q=."""
    if SemanticMemory is None:
        return jsonify({'error': 'semantic memory module unavailable'}), 503
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'error': 'q parameter is required'}), 400
    top_k  = min(int(request.args.get('top_k', 5)), 50)
    source = request.args.get('source')
    mem = SemanticMemory(DB_PATH)
    results = mem.search(query, top_k=top_k, source=source)
    return jsonify({'query': query, 'results': results, 'count': len(results)})

@app.route('/api/memory/recent')
def memory_recent():
    """List most recently stored memories."""
    if SemanticMemory is None:
        return jsonify({'error': 'semantic memory module unavailable'}), 503
    limit  = min(int(request.args.get('limit', 20)), 100)
    source = request.args.get('source')
    mem = SemanticMemory(DB_PATH)
    return jsonify({'results': mem.recent(limit=limit, source=source), 'total': mem.count()})

@app.route('/api/agents/list')
def agents_list():
    """List the agent roster with role descriptions and live status."""
    if list_agents is None:
        return jsonify({'error': 'agents module unavailable'}), 503
    return jsonify({'agents': list_agents()})

@app.route('/api/agents/route', methods=['POST'])
def agents_route():
    """Route a task description to the best-matching agent(s)."""
    if route_task is None:
        return jsonify({'error': 'agents module unavailable'}), 503
    data = request.get_json(silent=True) or {}
    description = (data.get('task') or data.get('description') or '').strip()
    if not description:
        return jsonify({'error': 'task is required'}), 400
    top_n = min(int(data.get('top_n', 3)), len(list_agents()) if list_agents else 3)
    return jsonify({'task': description, 'matches': route_task(description, top_n=top_n)})

@app.route('/api/agents/dispatch', methods=['POST'])
def agents_dispatch():
    """Route a task to the best-matching agent(s) and run their handler(s).

    Body: {"task": "...", "agent": "ForgeOps" (optional, force a specific agent),
           "top_n": 1 (optional, only used when "agent" is not given)}
    """
    if dispatch is None or dispatch_task is None:
        return jsonify({'error': 'agent handlers unavailable'}), 503
    data = request.get_json(silent=True) or {}
    task = (data.get('task') or data.get('description') or '').strip()
    if not task:
        return jsonify({'error': 'task is required'}), 400
    agent = data.get('agent')
    if agent:
        return jsonify(dispatch(agent, task))
    top_n = int(data.get('top_n', 1))
    return jsonify(dispatch_task(task, top_n=top_n))

@app.route('/api/ask', methods=['POST'])
def ask():
    """
    Natural-language entry point (Phase 3.3): route a free-form question to
    the best-matching agent, run its handler, and return a synthesized
    answer.

    Body: {"question": "..."} (also accepts "q" or "task")

    Response includes 'routed_to' (the agents.router match), 'result' (the
    raw dispatch result), and 'answer' -- an LLM-synthesized explanation if
    ANTHROPIC_API_KEY is set, otherwise a simple templated fallback built
    from 'routed_to'/'result'.
    """
    if route_task is None or dispatch is None:
        return jsonify({'error': 'agents module unavailable'}), 503
    data = request.get_json(silent=True) or {}
    question = (data.get('question') or data.get('q') or data.get('task') or '').strip()
    if not question:
        return jsonify({'error': 'question is required'}), 400

    matches = route_task(question, top_n=1)
    routed = matches[0]
    result = dispatch(routed['agent'], question)

    answer = _llm_answer(question, routed, result)
    if not answer:
        status = result.get('status', 'unknown') if isinstance(result, dict) else 'unknown'
        answer = (f"Routed to {routed['agent']} ({routed['role']}); "
                  f"handler status: {status}.")

    return jsonify({
        'question': question,
        'routed_to': routed,
        'result': result,
        'answer': answer,
        'timestamp': _now_iso(),
    })

@app.route('/api/reflect', methods=['POST', 'GET'])
def reflect():
    """Run a reflection cycle: summarize recent builds/telemetry/audit into semantic memory."""
    if run_reflection_cycle is None or SemanticMemory is None:
        return jsonify({'error': 'reflection module unavailable'}), 503
    mem = SemanticMemory(DB_PATH)
    return jsonify(run_reflection_cycle(mem))

@app.route('/api/decision-loop', methods=['POST', 'GET'])
def decision_loop():
    """Run one autonomous decide-and-delegate cycle: check thresholds,
    reflect, and dispatch any flagged issues to the responsible agent."""
    if run_decision_loop is None or SemanticMemory is None:
        return jsonify({'error': 'decision loop module unavailable'}), 503
    mem = SemanticMemory(DB_PATH)
    return jsonify(run_decision_loop(mem))

@app.route('/api/system/info')
def system_info():
    """Full system inventory for Heidi's context."""
    ursula, ursula_ep = _ursula_health()
    ph = _get_json(f'{PROTOHUB_URL}/health')
    tables = _db_query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")

    # Ursula_Suite block: agent statuses from memory_matrix.json plus the
    # latest test/report artifact summary (Phase 4.3).
    ursula_suite_agents = {}
    if MEMORY_MATRIX_PATH and MEMORY_MATRIX_PATH.exists():
        try:
            matrix_data = json.loads(MEMORY_MATRIX_PATH.read_text())
            ursula_suite_agents = matrix_data.get('agents', {})
        except Exception:
            ursula_suite_agents = {}

    ursula_suite_last_report = None
    ursula_suite_summary = None
    ursula_suite_signals = []
    if _ursula_summary:
        try:
            text, meta, signals = _ursula_summary()
            ursula_suite_summary = text
            ursula_suite_last_report = meta or None
            ursula_suite_signals = signals
        except Exception:
            pass

    return jsonify({
        'bridge':    {'port': PORT, 'uptime': round(time.time() - START_TIME), 'version': '1.0.0'},
        'ursula':    {'url': URSULA_URL, 'status': ursula.get('status') if ursula else 'offline', 'endpoint': ursula_ep},
        'protohub':  {'url': PROTOHUB_URL, 'status': ph.get('status') if ph else 'offline'},
        'database':  {'path': str(DB_PATH), 'exists': DB_PATH.exists(), 'tables': [r['name'] for r in tables]},
        'registry':  {'path': str(REGISTRY_PATH), 'exists': REGISTRY_PATH.exists(), 'builds': _registry_count()},
        'monitoring': current_status() if current_status else None,
        'ursula_suite': {
            'agents': ursula_suite_agents,
            'last_report': ursula_suite_last_report,
            'last_report_summary': ursula_suite_summary,
            'signals': ursula_suite_signals,
        },
        'timestamp': _now_iso(),
    })

# -- Startup ----------------------------------------------------------------------

if __name__ == '__main__':
    import sys

    db_found  = '(found)' if DB_PATH.exists()       else '(NOT FOUND -- check PROTOFORGE_DIR)'
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
        print(f'  Ursula         : connected at {ep} -- status: {ursula_data.get("status", "?")}')
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
