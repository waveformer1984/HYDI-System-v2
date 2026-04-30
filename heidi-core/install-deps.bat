@echo off
echo Installing HEIDI dependencies...
cd /d "%~dp0"
npm install express axios sqlite3 --save
echo.
echo Done. If sqlite3 failed, the in-memory fallback will work.
pause
