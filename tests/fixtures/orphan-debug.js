'use strict';
// Debug: does the close-time sweep see a grandchild whose parent already exited?
const AE = require('../../heidi-core/actions/action-executor.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pidFile = path.join(os.tmpdir(), `dl-orphan-dbg-${process.pid}.txt`);
const ORPHAN = `const fs=require('fs');const g=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));setTimeout(()=>process.exit(0),300);`;
const ex = new AE({});
ex.spawnProcess(process.execPath, ['-e', ORPHAN], { timeout_ms: 8000 }).then(
  (r) => console.log('RESOLVED', JSON.stringify(r).slice(0, 200)),
  (e) => console.log('REJECTED:', e.message.slice(0, 200))
);
setTimeout(() => {
  try { console.log('gpid:', fs.readFileSync(pidFile, 'utf8')); } catch { console.log('no pidFile'); }
  process.exit(0);
}, 14000);
