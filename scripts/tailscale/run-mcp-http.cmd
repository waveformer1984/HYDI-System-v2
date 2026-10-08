@echo off
REM ---------------------------------------------------------------------------
REM run-mcp-http.cmd -- wrapper invoked by the "ProtoForge MCP HTTP" scheduled
REM task (see serve-mcp.ps1). Runs the protoforge MCP server's HTTP transport
REM on 127.0.0.1:3470 and appends all output to logs\protoforge-mcp.log.
REM The server refuses to start without PROTOFORGE_MCP_TOKEN (read from the
REM repo's .env.local / .env), so this never serves unauthenticated.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0..\.."
if not exist logs mkdir logs
echo.>> logs\protoforge-mcp.log
echo [%date% %time%] === protoforge-mcp http starting ===>> logs\protoforge-mcp.log
node mcp\protoforge-mcp\src\server.js --http>> logs\protoforge-mcp.log 2>&1
echo [%date% %time%] === protoforge-mcp http exited (code %errorlevel%) ===>> logs\protoforge-mcp.log
endlocal
