# HEIDI Quick Start (Windows)

## 1. Install Dependencies
```batch
install-deps.bat
```

## 2. Start Ollama (Terminal 1)
```batch
ollama serve
```

## 3. Start HEIDI (Terminal 2)
```batch
start-heidi.bat
```

## 4. Test (Terminal 3)
```batch
test-heidi.bat
```

## PowerShell Alternative
```powershell
# Install deps
npm install express axios sqlite3 --save

# Start Ollama
ollama serve

# In another terminal:
.\Start-Heidi.ps1

# Test:
.\Test-Heidi.ps1
```

## What Fixed
- ✅ Ollama runs as service (`ollama serve` not `ollama run`)
- ✅ Dependencies installed locally (no NODE_PATH hacks)
- ✅ Batch files work without PowerShell execution policy
- ✅ Loud warning if sqlite3 missing (in-memory mode)
- ✅ Reflection rate limited (30s minimum)
- ✅ Full observability logging on /think endpoint
- ✅ All scripts use correct working directory

## Test Sequence
1. Health check → verifies Ollama + HEIDI running
2. Store memory → "remember: bananas_are_strategic_fact_42"
3. Recall → "what did I tell you?" (checks for bananas)
4. State check → shows request stats

If sqlite3 install fails, HEIDI still works but shows big warning box about memory-only mode.
