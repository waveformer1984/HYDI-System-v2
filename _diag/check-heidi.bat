@echo off
cd /d "%~dp0"
echo === health via 127.0.0.1 (IPv4) === > heidi-check.log
curl -sS -m 8 http://127.0.0.1:3006/api/health >> heidi-check.log 2>&1
echo. >> heidi-check.log
echo === root page (first bytes) === >> heidi-check.log
curl -sS -m 8 -o nul -w "HTTP %%{http_code}, %%{size_download} bytes" http://127.0.0.1:3006/ >> heidi-check.log 2>&1
echo. >> heidi-check.log
echo DONE >> heidi-check.log
