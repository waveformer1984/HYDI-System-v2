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

const child = spawn(OLLAMA, ['serve'], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
