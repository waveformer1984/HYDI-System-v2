'use strict';
// Does a non-detached grandchild survive when the parent exits at 300ms?
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pidFile = path.join(os.tmpdir(), `dl-surv-${process.pid}.txt`);
const ORPHAN = `const fs=require('fs');const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));setTimeout(()=>process.exit(0),300);`;
const child = spawn(process.execPath, ['-e', ORPHAN], { shell: false });
child.on('close', () => {
  const gpid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  console.log('t+0   gpid', gpid, 'alive:', alive(gpid));
  setTimeout(() => console.log('t+2s  gpid', gpid, 'alive:', alive(gpid)), 2000);
  setTimeout(() => console.log('t+6s  gpid', gpid, 'alive:', alive(gpid)), 6000);
});
setTimeout(() => process.exit(0), 8000);
