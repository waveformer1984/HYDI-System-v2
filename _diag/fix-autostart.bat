@echo off
ren "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Heidi AutoStart.lnk" "Heidi AutoStart.lnk.disabled"
echo REN_EXIT=%ERRORLEVEL% > "C:\Users\Owner\HYDI-System-v2\autostart-install.log"
echo --- Startup folder now contains --- >> "C:\Users\Owner\HYDI-System-v2\autostart-install.log"
dir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup" >> "C:\Users\Owner\HYDI-System-v2\autostart-install.log" 2>&1
echo DONE >> "C:\Users\Owner\HYDI-System-v2\autostart-install.log"
