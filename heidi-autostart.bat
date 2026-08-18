@echo off
REM [DEPRECATED] This launcher has been superseded by `npm run boot`.
REM
REM `npm run boot` (scripts/boot-agent.js + boot.config.json) is now the single
REM authoritative way to start the full HYDI system. It handles dependency
REM ordering, health gating, and graceful shutdown.
REM
REM To start the system:
REM   npm run boot
REM
REM To start Ollama separately (if not already running):
REM   ollama serve
REM
REM See BOOT_AGENT.md for full details.
echo.
echo [DEPRECATED] Use: npm run boot
echo See BOOT_AGENT.md for details.
echo.
