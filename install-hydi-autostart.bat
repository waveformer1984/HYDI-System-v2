@echo off
title HYDI - Install autostart
REM Creates a tiny launcher in the current user's Startup folder so the
REM full local HYDI stack (Ollama + Heidi Core + panel server) starts at login.

set "SC=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HYDI-Local.bat"

> "%SC%" echo @echo off
>> "%SC%" echo start "" /min "%~dp0start-hydi-local.bat"

echo.
echo Installed: %SC%
echo HYDI will now start automatically when you log in.
echo To undo, delete that file.
echo.
pause
