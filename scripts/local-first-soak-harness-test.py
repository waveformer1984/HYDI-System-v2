#!/usr/bin/env python3
"""Harness self-validation tests for scripts/local-first-soak.py.

Prevents regression of the SUPABASE_URL / url type bug.
"""

import importlib.util
import os
import sys
import traceback

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

spec = importlib.util.spec_from_file_location(
    'local_first_soak',
    os.path.join(REPO_ROOT, 'scripts', 'local-first-soak.py')
)
module = importlib.util.module_from_spec(spec)
# Prevent main() from running during import (guard is already present, but be safe)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def case(name, env, should_start):
    for k in ['HYDI_PERSISTENCE_MODE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL_CLOUD', 'HYDI_SERVICE_SECRET', 'HYDI_BASE']:
        os.environ.pop(k, None)
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    msg = ''
    try:
        module.validate_config()
        started = True
    except module.SoakConfigError as e:
        started = False
        msg = str(e)
    except Exception as e:
        started = False
        msg = str(e)
        traceback.print_exc()
    if started == should_start:
        print(f'[harness-test] {name}: PASS')
        return True
    else:
        print(f'[harness-test] {name}: FAIL (expected_start={should_start}, got={started})')
        if not started:
            print(f'  error: {msg}')
        return False


def main():
    base_env = {
        'SUPABASE_SERVICE_ROLE_KEY': 'sb_secret_test',
        'HYDI_SERVICE_SECRET': 'test_secret',
    }
    all_pass = True

    # 1. SUPABASE_URL unset -> refuse
    e = {**base_env, 'HYDI_PERSISTENCE_MODE': 'local'}
    all_pass &= case('SUPABASE_URL_unset_refuses', e, False)

    # 2. SUPABASE_URL valid local -> start
    e = {**base_env, 'HYDI_PERSISTENCE_MODE': 'local', 'SUPABASE_URL': 'http://127.0.0.1:54321'}
    all_pass &= case('SUPABASE_URL_local_starts', e, True)

    # 3. SUPABASE_URL=/rest/v1 -> refuse
    e = {**base_env, 'HYDI_PERSISTENCE_MODE': 'local', 'SUPABASE_URL': '/rest/v1'}
    all_pass &= case('SUPABASE_URL_path_refuses', e, False)

    # 4. local mode + cloud URL identical -> refuse
    e = {
        **base_env,
        'HYDI_PERSISTENCE_MODE': 'local',
        'SUPABASE_URL': 'http://cloud.example.com',
        'SUPABASE_URL_CLOUD': 'http://cloud.example.com'
    }
    all_pass &= case('local_mode_cloud_url_isolation_refuses', e, False)

    if all_pass:
        print('[harness-test] ALL PASS')
        sys.exit(0)
    else:
        print('[harness-test] FAILURES DETECTED')
        sys.exit(1)


if __name__ == '__main__':
    main()
