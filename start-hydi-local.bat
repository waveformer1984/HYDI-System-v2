@echo off
REM [DEPRECATED] This launcher has been superseded by `npm run boot`.
REM
REM `npm run boot` is the single authoritative way to start the full HYDI
REM system. It starts protoforge-core (port 3005), heidi-web (port 3000),
REM heidi-mobile-chat (port 3006), and the in-process hydi-orchestrator in
REM dependency order with health gating.
REM
REM To start the system:
REM   npm run boot
REM
REM See BOOT_AGENT.md for full details.
echo.
echo [DEPRECATED] Use: npm run boot
echo See BOOT_AGENT.md for details.
echo.
