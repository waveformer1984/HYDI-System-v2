'use strict';
// Deadline-enforcement fixture (manual, not jest): parent spawns a long-lived
// grandchild that holds stdout open — the shape that left mission #3942 stuck.
const AE = require('../../heidi-core/actions/action-executor.js');
const ex = new AE({});
const grandchild = `require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e6)'],{stdio:'inherit'});process.stdout.write('grandchild-started\\n');setInterval(()=>{},1e6);`;
const t0 = Date.now();
ex.spawnProcess(process.execPath, ['-e', grandchild], { timeout_ms: 3000 }).then(
  (r) => console.log('RESOLVED', Date.now() - t0, 'ms', JSON.stringify(r).slice(0, 120)),
  (e) => console.log('SETTLED-FAIL', Date.now() - t0, 'ms:', e.message.slice(0, 120))
);
