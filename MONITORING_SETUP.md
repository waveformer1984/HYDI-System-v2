# Minimal Monitoring Setup
# No overengineering. Just ruthless minimalism.

## 🎯 WHAT THIS ACTUALLY DOES

### **Self-Checking System**
- Runs health verification every 5 minutes automatically
- Logs results to `health-checks.log`
- Exits with error code on failure (for CI/CD)

### **One Real Alert**
- Single critical alert for payout failures
- Configurable: log, email, or webhook
- No dashboards, no graphs, just "something broke, deal with it"

### **One Tripwire**
- Alerts if failures > 3 in a row
- Catches flapping services and partial outages
- Auto-resets on recovery

### **Vercel Gap Closed**
- Bypasses CLI encoding issues with REST API
- Automated environment verification
- No more "I'll check manually"

---

## 🚀 QUICK SETUP

### **Option 1: GitHub Actions (Recommended)**
```bash
# 1. Add VERCEL_TOKEN to GitHub Secrets
# 2. Push the .github/workflows/health-monitor.yml file
# 3. Done - runs every 5 minutes automatically
```

### **Option 2: Windows Task Scheduler**
```powershell
# Create scheduled task
$action = New-ScheduledTaskAction -Execute "powershell" -Argument "-ExecutionPolicy Bypass -File schedule-health-check.ps1"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "HYDI Health Check" -Description "Run health check every 5 minutes"
```

### **Option 3: Manual Testing**
```bash
# Test the monitoring components
powershell -ExecutionPolicy Bypass -File schedule-health-check.ps1
powershell -ExecutionPolicy Bypass -File tripwire-detector.ps1
node vercel-api-check.js
```

---

## 📊 WHAT YOU GET

### **Before:**
- System was healthy when you remembered to check
- Silent failures between checks
- Manual verification required

### **After:**
- System checks itself every 5 minutes automatically
- Failures trigger immediate alerts
- Continuous verification without babysitting

---

## 🚨 ALERT CONFIGURATION

### **Email Alert Setup:**
```powershell
# In critical-alert.ps1, uncomment and configure:
$to = "your-email@example.com"
$smtpServer = "smtp.your-provider.com"
Send-MailMessage -To $to -Subject $subject -Body $body -SmtpServer $smtpServer
```

### **Webhook Alert Setup:**
```powershell
# In critical-alert.ps1, uncomment and configure:
$webhookUrl = "https://your-webhook-url"
Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload
```

---

## 🧪 VERIFICATION

### **Test the monitoring:**
```bash
# 1. Verify health check works
powershell -ExecutionPolicy Bypass -File schedule-health-check.ps1

# 2. Test tripwire (simulate failure)
# Temporarily break something, then run:
powershell -ExecutionPolicy Bypass -File tripwire-detector.ps1

# 3. Test Vercel API check
# Set VERCEL_TOKEN environment variable, then:
node vercel-api-check.js
```

---

## 🎯 THE ACHIEVEMENT

**You now have:**
- ✅ **System that checks itself** (no human babysitting)
- ✅ **Real alerts** (not just logs)
- ✅ **Tripwire detection** (catches consecutive failures)
- ✅ **Automated Vercel verification** (no more manual checks)

**This moves from "defensible when manually supervised" to "defensible continuously."**

**No applause. No big moments. Just fewer disasters.** 🛡️

**Status: MINIMAL MONITORING ESTABLISHED** 🚀
