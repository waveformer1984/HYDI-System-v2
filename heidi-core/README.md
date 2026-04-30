# HEIDI Core

Local AI agent with memory, reflection, and action capabilities.

## Quick Start (PowerShell)

```powershell
# 1. Setup
cd heidi-core
npm install

# 2. Start Ollama server (background)
ollama serve

# 3. In another terminal, start HEIDI
.\Start-Heidi.ps1

# 4. Test
Invoke-RestMethod http://localhost:3456/health

# 5. Run end-to-end test
.\Test-Heidi.ps1
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/state` | GET | System state |
| `/think` | POST | Main reasoning endpoint |
| `/chat` | POST | Conversational endpoint |
| `/reflect` | POST | Trigger reflection |
| `/act` | POST | Execute action |

## Example Usage (PowerShell)

```powershell
# Think
Invoke-RestMethod `
  -Uri http://localhost:3456/think `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"input": "Hello Heidi"}'

# Chat
Invoke-RestMethod `
  -Uri http://localhost:3456/chat `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"messages": [{"role": "user", "content": "Hi"}]}'

# Execute action
Invoke-RestMethod `
  -Uri http://localhost:3456/act `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"type": "log_event", "target": "test"}'

# Memory test (store then recall)
Invoke-RestMethod -Uri http://localhost:3456/think -Method POST -ContentType "application/json" -Body '{"input":"remember this: bananas are strategic"}'
Invoke-RestMethod -Uri http://localhost:3456/think -Method POST -ContentType "application/json" -Body '{"input":"what did I tell you?"}'
```

## Architecture

```
heidi-core/
├── brain/          # Ollama client
├── memory/         # SQLite store
├── reflect/        # Reflection engine
├── actions/        # Action executor
├── api/            # Express routes
├── data/           # SQLite database
└── server.js       # Main entry
```

## Environment Variables

```bash
HEIDI_PORT=3456
HEIDI_SECRET=your-secret
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

## Think Loop

```
input → retrieve context → generate → store → reflect → act
```

That's it. Simple, fast, actually works.
