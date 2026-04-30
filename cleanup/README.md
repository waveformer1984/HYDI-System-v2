# ProtoForge Cleanup & Hardware Optimization

This directory contains scripts to clean up your workspace and optimize your hardware for ProtoForge development.

## 🚨 IMPORTANT: Security First

Before running cleanup, ensure you've:
1. **Rotated all exposed secrets** (Stripe keys, webhook secrets)
2. **Backed up any critical data**
3. **Committed important changes to Git**

## 📁 Scripts Overview

### 1. `workspace-cleanup.ps1`

Cleans up the development workspace:

- Removes temporary files and caches
- Cleans build artifacts
- Scans for sensitive data
- Organizes folder structure
- Generates cleanup report

**Usage:**
```powershell
# Basic cleanup
.\workspace-cleanup.ps1

# Deep clean (includes Git history)
.\workspace-cleanup.ps1 -Deep

# Sanitize sensitive files (creates backups first)
.\workspace-cleanup.ps1 -Force -Backup

# Full cleanup
.\workspace-cleanup.ps1 -Deep -Force -Backup
```

### 2. `hardware-optimization.ps1`

Optimizes system performance:

- Power settings optimization
- Visual effects tuning
- Network configuration
- Storage optimization
- Memory management
- Developer-specific settings

**Usage:**
```powershell
# Check current status only
.\hardware-optimization.ps1

# Apply optimizations (requires admin)
.\hardware-optimization.ps1 -Apply

# Enable developer mode features
.\hardware-optimization.ps1 -Apply -DeveloperMode

# Enable game mode for performance
.\hardware-optimization.ps1 -Apply -GameMode
```

## 🧹 Cleanup Checklist

### Before Cleanup:
- [ ] Save all work
- [ ] Commit to Git if needed
- [ ] Close all applications
- [ ] Backup sensitive files

### After Cleanup:
- [ ] Verify Node.js modules work (`npm install` if needed)
- [ ] Check Git status
- [ ] Test essential scripts
- [ ] Review cleanup report

## 💻 Hardware Requirements

### Minimum:
- **CPU:** 4 cores
- **RAM:** 8GB
- **Storage:** 50GB free SSD
- **OS:** Windows 10/11 Pro

### Recommended:
- **CPU:** 8+ cores
- **RAM:** 16GB+
- **Storage:** 100GB+ NVMe SSD
- **GPU:** Not required but helpful for AI workloads

## ⚡ Performance Tips

### Memory Management:
- Close unused browser tabs
- Restart IDE daily
- Monitor memory usage with Task Manager

### Storage Optimization:
- Keep at least 10% free space
- Use SSD for primary drive
- Regular disk cleanup

### Network:
- Use wired connection when possible
- Configure DNS to 1.1.1.1 (Cloudflare)
- Check for background downloads

## 🔧 Troubleshooting

### Script Won't Run:
```powershell
# Allow script execution
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Permission Errors:
- Run PowerShell as Administrator
- Check antivirus isn't blocking scripts

### Out of Memory:
- Close unnecessary applications
- Increase virtual memory
- Consider RAM upgrade

## 📊 Reports

Both scripts generate reports in the `cleanup` folder:
- `cleanup-report.json` - Workspace cleanup results
- `hardware-optimization-report.json` - System optimization status

## 🔄 Maintenance Schedule

### Daily:
- Quick workspace cleanup
- Check memory usage

### Weekly:
- Full workspace cleanup
- Disk cleanup
- Review performance reports

### Monthly:
- Deep clean with Git history
- Hardware optimization
- Security audit

## 🚨 Emergency Procedures

If system becomes unstable:
1. Restart in Safe Mode
2. Restore from backup
3. Run System Restore
4. Contact IT support

## 📞 Support

For issues:
1. Check error logs
2. Review reports
3. Run diagnostics
4. Document steps taken

---

**Remember:** A clean workspace is a productive workspace. Regular maintenance prevents issues and keeps development smooth.
