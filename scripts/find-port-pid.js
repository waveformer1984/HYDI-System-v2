const { execSync } = require('child_process');
const port = parseInt(process.argv[2] || '3005', 10);
try {
  const pid = execSync(`powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess"`, { windowsHide: true }).toString().trim();
  if (!pid) { console.log(`No process listening on port ${port}`); process.exit(0); }
  const name = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).ProcessName"`, { windowsHide: true }).toString().trim();
  console.log(`Port ${port}: PID ${pid} (${name})`);
} catch (e) {
  console.log(`No process listening on port ${port}`);
}
