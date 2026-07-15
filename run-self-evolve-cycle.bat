@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
echo ==== %date% %time% ==== >> logs\self-evolve.log
node evolution\self-evolve-cycle.js >> logs\self-evolve.log 2>&1
endlocal
