'use strict';
// Does the CIM dump at close time include the orphan grandchild's row?
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pidFile = path.join(os.tmpdir(), `dl-sweep-dbg-${process.pid}.txt`);
const ORPHAN = `const fs=require('fs');const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));setTimeout(()=>process.exit(0),300);`;

const child = spawn(process.execPath, ['-e', ORPHAN], { shell: false });
child.stdout = { on() {} }; child.stderr = { on() {} };
const parentPid = child.pid;
console.log('parent pid:', parentPid);

child.on('close', () => {
  const ps = spawn('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|ForEach-Object{"$([int]$_.ProcessId) $([int]$_.ParentProcessId)"}'],
    { shell: false });
  let raw = '';
  ps.stdout.on('data', (d) => (raw += d));
  ps.on('close', () => {
    const gpid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith(String(gpid)));
    console.log('gpid:', gpid, '| its dump row:', JSON.stringify(line || 'NOT IN DUMP'));
    const rows = raw.trim().split(/\r?\n/).length;
    console.log('total rows:', rows, '| rows with PPID=' + parentPid + ':',
      raw.split(/\r?\n/).filter((l) => Number(l.trim().split(/\s+/)[1]) === parentPid).length);
    process.exit(0);
  });
});
setTimeout(() => process.exit(1), 25000);
