# HEIDI Startup Guide

## 🚀 Single Entry Point

**ONLY run this command:**
```powershell
.\HEIDI.ps1
```

That's it. No other scripts.

## 📋 Options

```powershell
# Normal startup (with Ollama)
.\HEIDI.ps1

# Skip Ollama (tasks/health only)
.\HEIDI.ps1 -SkipOllama

# Kill existing processes first
.\HEIDI.ps1 -KillFirst

# Both options
.\HEIDI.ps1 -SkipOllama -KillFirst
```

## 🔄 What It Does

1. **Process Cleanup** (if -KillFirst)
   - Kills anything on port 3458
   - Kills orphaned node processes

2. **Ollama Check** (unless -SkipOllama)
   - Checks if Ollama is running
   - Starts it if needed
   - Waits for it to be ready

3. **Dependencies**
   - Verifies package.json exists
   - Runs npm install if needed

4. **Start HEIDI**
   - Launches on port 3458
   - Shows status summary

## 📱 Mobile UI

After HEIDI starts:
1. Open `mobile-ui.html` in your browser
2. Or access via ngrok for mobile testing

## 🛠️ Troubleshooting

### Port already in use?
```powershell
.\HEIDI.ps1 -KillFirst
```

### Ollama issues?
```powershell
.\HEIDI.ps1 -SkipOllama
```

### Dependencies missing?
The script auto-installs them.

### Still broken?
```powershell
# Nuclear option
.\HEIDI.ps1 -KillFirst -SkipOllama
```

## ⚠️ IMPORTANT

- **DO NOT** run any other start scripts
- **DO NOT** use `&&` in PowerShell (use `;`)
- **DO NOT** manually manage processes

This script handles everything. One command, one system.
