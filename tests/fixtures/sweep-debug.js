'use strict';
const { spawn } = require('child_process');
const t0 = Date.now();
const ps = spawn('powershell', ['-NoProfile', '-Command',
  'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|ForEach-Object{"$([int]$_.ProcessId) $([int]$_.ParentProcessId)"}'],
  { shell: false });
let n = 0;
ps.stdout.on('data', (d) => { n += d.toString().trim().split(/\r?\n/).length; });
ps.stderr.on('data', (d) => console.log('STDERR', d.toString().slice(0, 200)));
ps.on('close', (c) => console.log('close code', c, 'lines', n, 'in', Date.now() - t0, 'ms'));
ps.on('error', (e) => console.log('ERR', e.message));
