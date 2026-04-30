@echo off
cd /d "%~dp0"
echo Running HEIDI Stress Tests...
echo Make sure HEIDI is running (start-heidi.bat)
echo.
node stress-test.js
pause
