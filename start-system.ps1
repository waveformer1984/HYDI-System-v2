# [DEPRECATED] This launcher has been superseded by `npm run boot`.
#
# `npm run boot` (scripts/boot-agent.js) is the single authoritative way to
# start the full HYDI system. It handles dependency ordering, health gating,
# process supervision, and graceful shutdown — everything this script did
# manually.
#
# To start the system:
#   npm run boot
#
# See BOOT_AGENT.md for full details.

Write-Host ""
Write-Host "[DEPRECATED] Use: npm run boot" -ForegroundColor Yellow
Write-Host "See BOOT_AGENT.md for details." -ForegroundColor Cyan
Write-Host ""
