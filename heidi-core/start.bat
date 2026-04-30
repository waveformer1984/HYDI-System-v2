@echo off
cd /d "%~dp0"
set NODE_PATH=..\node_modules
node server.js
