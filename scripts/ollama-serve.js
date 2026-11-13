'use strict';
// PM2-persistent Ollama server. Runs `ollama serve` with the verified
// MemoryOps env in the launch context — the tray app ignores these, so
// the serve process must be spawned directly. Replaces the temporary
// hidden-PowerShell launch; PM2Resurrect restores it at boot.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const OLLAMA = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');
const env = {
  ...process.env,
  OLLAMA_HOST: '127.0.0.1:11434',
  OLLAMA_MAX_LOADED_MODELS: '1',
  OLLAMA_CONTEXT_LENGTH: '4096',
  OLLAMA_NUM_PARALLEL: '1',
  OLLAMA_KEEP_ALIVE: '2m',
};

require('../lib/runtime/provenance').recordProcessProvenance('ollama-serve', { root: path.resolve(__dirname, '..') }).catch(() => null);

// Orphan sweep: PM2 force-kills this wrapper without tree-kill, so a previous
// `ollama serve` grandchild (and its llama-server runners) can survive and
// hold :11434 / ~2GB. PM2 runs exactly one wrapper, so every serve/runner
// found at startup is stale by definition — remove them before binding.
function sweepStaleOllama() {
  try {
    require('child_process').execFileSync('powershell', [
      '-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='ollama.exe' OR Name='llama-server.exe'\" | " +
      "Where-Object { $_.CommandLine -match 'serve|llama-server' } | " +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ], { timeout: 15000, windowsHide: true, stdio: 'ignore' });
  } catch { /* sweep is best-effort; bind failure below is the real signal */ }
}
sweepStaleOllama();

const child = spawn(OLLAMA, ['serve'], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
