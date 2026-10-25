'use strict';

/**
 * scripts/hydi-doctor.sh picks OPEN_PORT — the port in its
 * "NEXT STEP: open http://127.0.0.1:<port>" line.
 *
 * Bug: the runit service named "hydi" IS llama.cpp (termux/services/hydi/run
 * serves HYDI_LLAMA_PORT/LLAMA_PORT, default 8080). Its port was lumped into
 * RUN_PORT, which outranked hydi.py's own port, so the doctor pointed the
 * phone at the inference backend instead of the dashboard on :3006.
 *
 * This test runs the real script with stub runit services and a fake curl:
 * both 8080 (llama) and 3006 (hydi.py) "listen", and the doctor must still
 * choose 3006.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DOCTOR = path.join(ROOT, 'scripts', 'hydi-doctor.sh').replace(/\\/g, '/');

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-doctor-'));
  const bin = path.join(tmp, 'bin');
  const home = path.join(tmp, 'home');
  const svdir = path.join(tmp, 'prefix', 'var', 'service');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(svdir, 'hydi'), { recursive: true });
  fs.mkdirSync(path.join(svdir, 'hydi-daemon'), { recursive: true });
  // Modeled on termux/services/*/run — "hydi" is llama.cpp on 8080,
  // "hydi-daemon" is hydi.py on 3006.
  fs.writeFileSync(path.join(svdir, 'hydi', 'run'),
    '#!/bin/sh\nport="${HYDI_LLAMA_PORT:-${LLAMA_PORT:-8080}}"\nexec "$bin" --port "$port"\n');
  fs.writeFileSync(path.join(svdir, 'hydi-daemon', 'run'),
    '#!/bin/sh\nport="${HYDI_PY_PORT:-3006}"\nexec "$py" "$script" server "$port"\n');
  // Fake curl: reports the ports in FAKE_LISTENING as answering HTTP,
  // everything else as closed. The doctor's probe only needs the code.
  fs.writeFileSync(path.join(bin, 'curl'),
    '#!/bin/sh\n' +
    'url=""\n' +
    'for a in "$@"; do case $a in http*) url=$a;; esac; done\n' +
    "port=$(printf '%s' \"$url\" | sed -n 's|.*:\\([0-9][0-9]*\\)/.*|\\1|p')\n" +
    'case ",${FAKE_LISTENING}," in *,"$port",*) printf \'200\';; *) printf \'000\';; esac\n');
  fs.chmodSync(path.join(bin, 'curl'), 0o755);
  return { tmp, bin, home };
}

function runDoctor(env = {}) {
  const { tmp, bin, home } = makeFixture();
  return execFileSync('sh', [DOCTOR], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      HOME: home,
      USERPROFILE: home,
      PREFIX: path.join(tmp, 'prefix'),
      TMPDIR: tmp,
      FAKE_LISTENING: '8080,3006',
      ...env,
    },
  });
}

describe('hydi-doctor.sh OPEN_PORT selection', () => {
  it('opens the hydi.py dashboard port, never the llama.cpp port', () => {
    const out = runDoctor();
    expect(out).toContain('NEXT STEP: open http://127.0.0.1:3006');
    expect(out).not.toContain('NEXT STEP: open http://127.0.0.1:8080');
  }, 90000);

  it('still reports llama.cpp as listening without choosing it', () => {
    const out = runDoctor();
    expect(out).toMatch(/port 8080 \(llama\): listening/);
    expect(out).toContain('NEXT STEP: open http://127.0.0.1:3006');
  }, 90000);
});
