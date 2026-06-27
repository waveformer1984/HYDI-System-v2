@echo off
copy /Y "C:\Users\Owner\HYDI-System-v2\heidi-autostart.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\heidi-autostart.bat"
echo COPY_EXIT=%ERRORLEVEL% > "C:\Users\Owner\HYDI-System-v2\autostart-install.log"
echo --- Startup folder contents --- >> "C:\Users\Owner\HYDI-System-v2\autostart-install.log"
dir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup" >> "C:\Users\Owner\HYDI-System-v2\autostart-install.log" 2>&1
echo DONE >> "C:\Users\Owner\HYDI-System-v2\autostart-install.log"
