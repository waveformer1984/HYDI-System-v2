'use strict';
// Deadline-fixture for staged mission 1: a parent that spawns one non-detached
// and one detached grandchild (120s sleep each) and prints all three PIDs.
// The detached grandchild escapes the libuv Job — it is the sweep's real test.
const { spawn } = require('child_process');
const nonDetached = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], { stdio: 'ignore' });
const detached = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], { stdio: 'ignore', detached: true });
console.log(`PIDS parent=${process.pid} nonDetached=${nonDetached.pid} detached=${detached.pid}`);
setTimeout(() => {}, 120000);
