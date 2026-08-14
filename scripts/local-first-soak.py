#!/usr/bin/env python3
"""1-hour local-first persistence soak for HYDI.

Exercises health, Ursula, project+track CRUD, system health, dashboard collector.
Performs one controlled local-DB restart and one HYDI process restart.
Fails fast on invalid/missing environment.
Writes report to artifacts/local-first-soak/<ts>/
"""

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


class SoakConfigError(Exception):
    pass


def get_jwt_secret():
    """Discover the local Supabase JWT secret."""
    if os.environ.get('SUPABASE_JWT_SECRET'):
        return os.environ['SUPABASE_JWT_SECRET'].strip()
    try:
        raw = subprocess.run(
            ['docker', 'inspect', '--format={{json .Config.Env}}', 'supabase_db_HYDI-System-v2'],
            capture_output=True, text=True, timeout=15
        )
        if raw.returncode == 0 and raw.stdout:
            envs = json.loads(raw.stdout.strip())
            for e in envs:
                if e.startswith('JWT_SECRET='):
                    return e.split('=', 1)[1]
    except Exception as e:
        print(f'[soak] warning: could not discover JWT_SECRET: {e}', flush=True)
    return None


def generate_service_jwt(jwt_secret):
    """Sign a minimal service_role JWT for PostgREST."""
    if not jwt_secret:
        raise SoakConfigError('SUPABASE_JWT_SECRET is not available; cannot create service_role JWT')
    now = int(time.time())
    header = base64.urlsafe_b64encode(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()).rstrip(b'=')
    payload = base64.urlsafe_b64encode(json.dumps({
        'role': 'service_role',
        'iat': now,
        'exp': now + 3600,
        'iss': 'hydi-soak'
    }).encode()).rstrip(b'=')
    to_sign = f'{header.decode()}.{payload.decode()}'.encode()
    sig = base64.urlsafe_b64encode(hmac.new(jwt_secret.encode(), to_sign, hashlib.sha256).digest()).rstrip(b'=')
    return f'{header.decode()}.{payload.decode()}.{sig.decode()}'


def load_dotenv():
    """Load .env and .env.local into os.environ only for keys not already set."""
    for name in ['.env', '.env.local']:
        p = REPO_ROOT / name
        if not p.exists():
            continue
        try:
            for raw in p.read_text().splitlines():
                raw = raw.strip()
                if not raw or raw.startswith('#'):
                    continue
                if '=' not in raw:
                    continue
                k, v = raw.split('=', 1)
                k = k.strip()
                v = v.strip()
                # strip quotes and carriage returns
                if len(v) >= 2 and ((v[0] == '"' and v[-1] == '"') or (v[0] == "'" and v[-1] == "'")):
                    v = v[1:-1]
                v = v.replace('\r', '').strip()
                if os.environ.get(k) is None:
                    os.environ[k] = v
        except Exception as e:
            print(f'[soak] warning: could not read {name}: {e}', flush=True)


def validate_config():
    """Fail-fast validation of the soak environment. Returns a sanitized summary dict."""
    mode = os.environ.get('HYDI_PERSISTENCE_MODE', 'local')
    supabase_url = os.environ.get('SUPABASE_URL', '').strip()
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    cloud_url = os.environ.get('SUPABASE_URL_CLOUD', '').strip()
    secret = os.environ.get('HYDI_SERVICE_SECRET', '').strip()
    base = os.environ.get('HYDI_BASE', 'http://localhost:3001').strip()

    if mode != 'local':
        raise SoakConfigError(f'HYDI_PERSISTENCE_MODE must be local for this soak (got: {mode})')

    if not supabase_url:
        raise SoakConfigError('SUPABASE_URL is missing or empty')

    if not re.match(r'^https?://', supabase_url):
        raise SoakConfigError(f'SUPABASE_URL is not a valid HTTP URL: {supabase_url}')

    if cloud_url and supabase_url == cloud_url:
        raise SoakConfigError(f'SUPABASE_URL ({supabase_url}) is identical to SUPABASE_URL_CLOUD in local mode')

    if not supabase_key:
        raise SoakConfigError('SUPABASE_SERVICE_ROLE_KEY is missing or empty')

    if not secret:
        raise SoakConfigError('HYDI_SERVICE_SECRET is missing or empty')

    return {
        'HYDI_PERSISTENCE_MODE': mode,
        'SUPABASE_URL': supabase_url,
        'SUPABASE_SERVICE_ROLE_KEY': '<set>',
        'SUPABASE_URL_CLOUD': cloud_url or '<not set>',
        'HYDI_BASE': base,
    }


def token(secret):
    ts = str(int(time.time() * 1000))
    req_id = 'soak'
    service = 'local-test'
    payload = f'{ts}:{req_id}:{service}'.encode()
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f'{ts}.{req_id}.{service}.{sig}'


def http_get(url, headers=None, timeout=15):
    start = time.time()
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            _ = r.read()
        return {'ok': True, 'latency_ms': int((time.time() - start) * 1000), 'status': r.status}
    except Exception as e:
        return {'ok': False, 'latency_ms': int((time.time() - start) * 1000), 'error': str(e)}


def http_post(url, data, headers=None, timeout=15):
    start = time.time()
    try:
        body = json.dumps(data).encode()
        req = urllib.request.Request(url, data=body, headers=headers or {}, method='POST')
        with urllib.request.urlopen(req, timeout=timeout) as r:
            _ = r.read()
        return {'ok': True, 'latency_ms': int((time.time() - start) * 1000), 'status': r.status}
    except Exception as e:
        return {'ok': False, 'latency_ms': int((time.time() - start) * 1000), 'error': str(e)}


def get_auth_headers():
    api_key = (
        os.environ.get('SUPABASE_ANON_KEY', '').strip()
        or os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    )
    if not api_key:
        raise SoakConfigError('No SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY available')
    jwt_secret = get_jwt_secret()
    jwt = generate_service_jwt(jwt_secret)
    return {'apikey': api_key, 'Authorization': f'Bearer {jwt}'}


def supabase_rest(method, path, data=None, prefer='return=representation'):
    start = time.time()
    try:
        cfg = validate_config()
        url = f"{cfg['SUPABASE_URL']}{path}"
        body = json.dumps(data).encode() if data is not None else None
        hdrs = get_auth_headers()
        hdrs['Content-Type'] = 'application/json'
        if prefer:
            hdrs['Prefer'] = prefer
        req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
        with urllib.request.urlopen(req, timeout=15) as r:
            payload = r.read()
        return {
            'ok': True,
            'latency_ms': int((time.time() - start) * 1000),
            'status': r.status,
            'body': payload.decode() if payload else ''
        }
    except Exception as e:
        return {'ok': False, 'latency_ms': int((time.time() - start) * 1000), 'error': str(e)}


def record(events, success, fail, latencies, name, res):
    if name in success and name in fail and name in latencies:
        if res['ok']:
            success[name] += 1
            latencies[name].append(res['latency_ms'])
        else:
            fail[name] += 1
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': name, **res})


def percentile(arr, p):
    if not arr:
        return None
    s = sorted(arr)
    k = (len(s) - 1) * p / 100.0
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return round(s[f] + (k - f) * (s[c] - s[f]), 2)


def preflight(events, secret):
    results = {}
    pre_start = datetime.now(timezone.utc).isoformat()
    cfg = validate_config()

    # local supabase rest
    r = supabase_rest('GET', '/rest/v1/system_dashboard?select=*&limit=1')
    results['local_supabase_rest'] = r['ok']
    record(events, {}, {}, {}, 'preflight_supabase', r)

    # hydi health
    r = http_get(f"{cfg['HYDI_BASE']}/api/health")
    results['hydi_health'] = r['ok']
    record(events, {}, {}, {}, 'preflight_health', r)

    # ursula
    r = http_get(f"{cfg['HYDI_BASE']}/api/ursula/status")
    results['ursula'] = r['ok']
    record(events, {}, {}, {}, 'preflight_ursula', r)

    # collector
    r = run_collector(events)
    results['collector'] = r['ok']

    # persistence write/read probe
    probe_id = f'soak-preflight-{int(time.time())}'
    r = supabase_rest('POST', '/rest/v1/system_health_runs', {
        'status': 'OK',
        'environment': 'soak',
        'details': {'source': 'soak-preflight', 'probe_id': probe_id}
    })
    results['persistence_write'] = r['ok']
    record(events, {}, {}, {}, 'preflight_persistence_write', r)

    pre_end = datetime.now(timezone.utc).isoformat()

    return {
        'preflight_start': pre_start,
        'preflight_end': pre_end,
        'local_supabase_url': cfg['SUPABASE_URL'],
        'persistence_mode': cfg['HYDI_PERSISTENCE_MODE'],
        'cloud_url': cfg['SUPABASE_URL_CLOUD'],
        'health_result': results.get('hydi_health', False),
        'persistence_result': results.get('persistence_write', False),
        'all_passed': all(results.values()) and results,
    }


def run_collector(events):
    start = time.time()
    try:
        r = subprocess.run(
            ['python3', str(REPO_ROOT / 'tools' / 'dashboard-status' / 'status_collector.py')],
            capture_output=True, text=True, timeout=120, cwd=str(REPO_ROOT)
        )
        ok = r.returncode == 0
        if ok:
            try:
                out = json.loads(r.stdout)
                ok = bool(out.get('uploaded'))
            except Exception:
                ok = False
        res = {'ok': ok, 'latency_ms': int((time.time() - start) * 1000), 'error': r.stderr if not ok else ''}
    except Exception as e:
        res = {'ok': False, 'latency_ms': int((time.time() - start) * 1000), 'error': str(e)}
    record(events, {}, {}, {}, 'collector', res)
    return res


def create_test_records(project_user):
    cfg = validate_config()
    ts = int(time.time())

    # project
    r = supabase_rest('POST', '/rest/v1/rezonate_projects', {
        'name': f'soak-project-{ts}',
        'user_id': project_user,
        'tempo': 120
    })
    if not r['ok']:
        raise SoakConfigError(f'could not create soak project: {r}')
    try:
        project = json.loads(r['body'])
    except Exception:
        raise SoakConfigError(f'could not parse project create response: {r}')
    if not project or not isinstance(project, list) or not project[0].get('id'):
        raise SoakConfigError(f'project create returned no id: {r}')
    project_id = project[0]['id']

    # track
    r = supabase_rest('POST', '/rest/v1/rezonate_tracks', {
        'project_id': project_id,
        'name': f'soak-track-{ts}',
        'type': 'audio',
        'volume': 0.0
    })
    if not r['ok']:
        raise SoakConfigError(f'could not create soak track: {r}')
    try:
        track = json.loads(r['body'])
    except Exception:
        raise SoakConfigError(f'could not parse track create response: {r}')
    if not track or not isinstance(track, list) or not track[0].get('id'):
        raise SoakConfigError(f'track create returned no id: {r}')
    track_id = track[0]['id']

    return project_id, track_id


def cycle(n, project_id, track_id, project_user, events, success, fail, latencies):
    # health
    cfg = validate_config()
    record(events, success, fail, latencies, 'health', http_get(f"{cfg['HYDI_BASE']}/api/health"))

    # ursula
    record(events, success, fail, latencies, 'ursula', http_get(f"{cfg['HYDI_BASE']}/api/ursula/status"))

    # project read
    record(events, success, fail, latencies, 'project_get', supabase_rest('GET', f'/rest/v1/rezonate_projects?id=eq.{project_id}&select=*'))

    # project update
    record(events, success, fail, latencies, 'project_update', supabase_rest('PATCH', f'/rest/v1/rezonate_projects?id=eq.{project_id}', {'tempo': 110 + (n % 20)}))

    # project list
    record(events, success, fail, latencies, 'project_list', supabase_rest('GET', f'/rest/v1/rezonate_projects?user_id=eq.{project_user}&select=*'))

    # track read
    record(events, success, fail, latencies, 'track_get', supabase_rest('GET', f'/rest/v1/rezonate_tracks?id=eq.{track_id}&select=*'))

    # track update (ping-pong volume)
    record(events, success, fail, latencies, 'track_update', supabase_rest('PATCH', f'/rest/v1/rezonate_tracks?id=eq.{track_id}', {'volume': (n % 20) - 10}))

    # track list
    record(events, success, fail, latencies, 'tracks_list', supabase_rest('GET', f'/rest/v1/rezonate_tracks?project_id=eq.{project_id}&select=*'))

    # track create (small additional write)
    record(events, success, fail, latencies, 'track_create', supabase_rest('POST', '/rest/v1/rezonate_tracks', {
        'project_id': project_id,
        'name': f'soak-extra-{n}',
        'type': 'audio',
        'volume': n % 100
    }, prefer=''))

    # system health update
    record(events, success, fail, latencies, 'system_health', supabase_rest('POST', '/rest/v1/system_health_runs', {
        'status': 'OK',
        'environment': 'soak',
        'details': {'cycle': n, 'source': 'soak'}
    }))

    # collector
    run_collector(events)
    # mark collector as success/fail through events mapping later


def direct_db_verify(label, project_id, track_id, events):
    r = supabase_rest('GET', f'/rest/v1/rezonate_projects?id=eq.{project_id}&select=*')
    ok = r['ok'] and project_id in r.get('body', '')
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': f'data_integrity_{label}', 'project_ok': ok, 'track_id': track_id})
    return ok


def db_restart(events):
    start = time.time()
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': 'db_restart', 'action': 'stop'})
    subprocess.run(['docker', 'stop', 'supabase_db_HYDI-System-v2'], check=False)
    time.sleep(5)
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': 'db_restart', 'action': 'start'})
    subprocess.run(['docker', 'start', 'supabase_db_HYDI-System-v2'], check=False)
    # wait for hydi health and then db
    cfg = validate_config()
    first_op = None
    for _ in range(60):
        res = http_get(f"{cfg['HYDI_BASE']}/api/health")
        if res['ok']:
            pr = supabase_rest('GET', '/rest/v1/system_dashboard?select=*&limit=1')
            if pr['ok']:
                first_op = 'GET system_dashboard'
                break
        time.sleep(2)
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': 'db_restart', 'action': 'recovered', 'duration_seconds': int(time.time() - start), 'first_successful_op': first_op})
    return first_op


def hydi_restart(events):
    start = time.time()
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': 'hydi_restart', 'action': 'stop'})
    subprocess.run(['pkill', '-f', 'next dev'], check=False)
    time.sleep(5)
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': 'hydi_restart', 'action': 'start'})
    subprocess.Popen(
        ['npx', 'next', 'dev', '--hostname', '0.0.0.0', '--port', '3001'],
        cwd=str(REPO_ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
    )
    cfg = validate_config()
    first_op = None
    for _ in range(60):
        res = http_get(f"{cfg['HYDI_BASE']}/api/health")
        if res['ok']:
            first_op = 'GET /api/health'
            break
        time.sleep(2)
    events.append({'ts': datetime.now(timezone.utc).isoformat(), 'op': 'hydi_restart', 'action': 'recovered', 'duration_seconds': int(time.time() - start), 'first_successful_op': first_op})
    return first_op


def summary(events, success, fail, latencies, duration, out_dir):
    metrics = {}
    for k, v in latencies.items():
        metrics[k] = {
            'success': success[k],
            'failures': fail[k],
            'p95': percentile(v, 95),
            'p99': percentile(v, 99),
            'avg': round(sum(v) / len(v), 2) if v else None,
            'min': min(v) if v else None,
            'max': max(v) if v else None,
        }
    # add collector metrics from events
    collector_latencies = [e['latency_ms'] for e in events if e['op'] == 'collector' and e.get('ok')]
    metrics['collector'] = {
        'success': len([e for e in events if e['op'] == 'collector' and e.get('ok')]),
        'failures': len([e for e in events if e['op'] == 'collector' and not e.get('ok')]),
        'p95': percentile(collector_latencies, 95),
        'p99': percentile(collector_latencies, 99),
        'avg': round(sum(collector_latencies) / len(collector_latencies), 2) if collector_latencies else None,
        'min': min(collector_latencies) if collector_latencies else None,
        'max': max(collector_latencies) if collector_latencies else None,
    }
    total = sum(metrics[k]['success'] + metrics[k]['failures'] for k in metrics)
    overall = {
        'total_operations': total,
        'success': sum(metrics[k]['success'] for k in metrics),
        'failures': sum(metrics[k]['failures'] for k in metrics),
        'success_rate_percent': round(100.0 * sum(metrics[k]['success'] for k in metrics) / total, 2) if total else 0,
        'duration_seconds': duration,
        'completed_at': datetime.now(timezone.utc).isoformat()
    }
    report = {
        'overall': overall,
        'metrics': metrics,
        'events': events
    }
    (out_dir / 'metrics.json').write_text(json.dumps(report, indent=2, default=str))
    md = ['# Corrected Local-First 1-Hour Soak Report\n', f'- Duration: {duration}s\n', f'- Completed: {overall["completed_at"]}\n', f'- Total ops: {total}\n', f'- Success: {overall["success"]}\n', f'- Failures: {overall["failures"]}\n', f'- Success rate: {overall["success_rate_percent"]}%\n\n']
    md.append('| Operation | Success | Failures | p95 (ms) | p99 (ms) |\n')
    md.append('|---|---|---|---|---|\n')
    for k, m in metrics.items():
        md.append(f'| {k} | {m["success"]} | {m["failures"]} | {m["p95"]} | {m["p99"]} |\n')
    (out_dir / 'report.md').write_text(''.join(md))
    return overall


def main():
    load_dotenv()

    try:
        cfg = validate_config()
    except SoakConfigError as e:
        print(f'[soak] CONFIG ERROR: {e}', flush=True)
        sys.exit(1)

    print('[soak] sanitized configuration:', flush=True)
    for k, v in cfg.items():
        print(f'  {k}={v}', flush=True)
    print('[soak] preflight starting...', flush=True)

    out_dir = REPO_ROOT / 'artifacts' / 'local-first-soak' / datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    out_dir.mkdir(parents=True, exist_ok=True)

    events = []
    success = {
        'health': 0, 'ursula': 0, 'project_get': 0, 'project_update': 0, 'project_list': 0,
        'track_get': 0, 'track_update': 0, 'tracks_list': 0, 'track_create': 0, 'system_health': 0
    }
    fail = {k: 0 for k in success}
    latencies = {k: [] for k in success}

    pre = preflight(events, os.environ['HYDI_SERVICE_SECRET'])
    if not pre['all_passed']:
        (out_dir / 'preflight.json').write_text(json.dumps(pre, indent=2))
        print('[soak] PREFLIGHT FAILED', flush=True)
        sys.exit(2)

    (out_dir / 'preflight.json').write_text(json.dumps(pre, indent=2))
    print(f'[soak] preflight passed in {pre["preflight_start"]} -> {pre["preflight_end"]}', flush=True)
    print(f'[soak] creating isolated test records in local Supabase...', flush=True)

    project_user = os.environ.get('SOAK_USER_ID', '11111111-1111-1111-1111-111111111111')
    project_id, track_id = create_test_records(project_user)
    print(f'[soak] project_id={project_id} track_id={track_id}', flush=True)

    # verify directly after creation
    direct_db_verify('after_creation', project_id, track_id, events)

    duration = int(os.environ.get('SOAK_DURATION', '3600'))
    interval = int(os.environ.get('SOAK_INTERVAL', '45'))

    print(f'[soak] starting 60-minute cycle, duration={duration}s interval={interval}s', flush=True)
    start = time.time()
    end = start + duration
    n = 0
    db_done = False
    hydi_done = False

    while time.time() < end:
        cycle(n, project_id, track_id, project_user, events, success, fail, latencies)
        n += 1
        elapsed = time.time() - start
        if not db_done and elapsed > duration * 0.25:
            print('[soak] controlled DB restart...', flush=True)
            db_restart(events)
            direct_db_verify('after_db_restart', project_id, track_id, events)
            db_done = True
        if not hydi_done and elapsed > duration * 0.55:
            print('[soak] controlled HYDI restart...', flush=True)
            hydi_restart(events)
            direct_db_verify('after_hydi_restart', project_id, track_id, events)
            hydi_done = True
        sleep = interval - (time.time() - (start + n * interval))
        if sleep > 0:
            time.sleep(sleep)

    overall = summary(events, success, fail, latencies, duration, out_dir)
    # final data integrity
    direct_db_verify('final', project_id, track_id, events)
    (out_dir / 'metrics.json').write_text(json.dumps({'overall': overall, 'metrics': {k: {m: (v if not isinstance(v, float) or v is None else round(v, 2)) for m, v in metrics.items()} for k, metrics in json.loads((out_dir / 'metrics.json').read_text())['metrics'].items()}, 'events': events}, indent=2, default=str))
    print(f'[soak] finished. success_rate={overall["success_rate_percent"]}% output={out_dir}', flush=True)


if __name__ == '__main__':
    main()
