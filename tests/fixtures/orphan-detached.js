'use strict';
// Job-object test: detached grandchild should SURVIVE the parent's exit —
// libuv's per-child job only reaches job-member descendants.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pidFile = path.join(os.tmpdir(), `dl-det-${process.pid}.txt`);
const ORPHAN = `const fs=require('fs');const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'ignore',detached:true});fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));setTimeout(()=>process.exit(0),300);`;
const child = spawn(process.execPath, ['-e', ORPHAN], { shell: false });
child.on('close', () => {
  const gpid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  console.log('detached t+0   gpid', gpid, 'alive:', alive(gpid));
  setTimeout(() => {
    console.log('detached t+3s  gpid', gpid, 'alive:', alive(gpid));
    if (alive(gpid)) { try { process.kill(gpid, 'SIGKILL'); console.log('  cleaned up', gpid); } catch { /* gone */ } }
    process.exit(0);
  }, 3000);
});
