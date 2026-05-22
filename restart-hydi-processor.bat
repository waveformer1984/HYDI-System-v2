@echo off
echo Restarting hydi-processor via PM2...
call npm exec --prefix "C:\Users\Owner\AppData\Roaming\npm" -- pm2 restart hydi-processor
echo.
echo Done. Press any key to close.
pause
