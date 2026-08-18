# [DEPRECATED] This installer has been superseded by scripts/install-boot-service.ps1.
#
# This script referenced the stale F:\HYDI_System path and used nssm to install
# Windows services that are no longer the recommended way to run HYDI.
#
# To install HYDI as a per-user logon task (no admin needed):
#   powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1
#
# To start the system manually:
#   npm run boot
#
# See BOOT_AGENT.md for full details.

Write-Host ""
Write-Host "[DEPRECATED] This script is no longer maintained." -ForegroundColor Yellow
Write-Host "Use: scripts\install-boot-service.ps1  (or)  npm run boot" -ForegroundColor Cyan
Write-Host "See BOOT_AGENT.md for details." -ForegroundColor Cyan
Write-Host ""
