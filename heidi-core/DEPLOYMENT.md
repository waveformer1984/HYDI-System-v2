# HEIDI Deployment Guide

## Local Development (Port 3458)

### Quick Start
```powershell
# Complete startup (Ollama + HEIDI)
.\Start-Complete.ps1

# Test everything
.\Test-Heidi-Robust.ps1
```

### Individual Components
```powershell
# Start Ollama only
.\Start-Ollama.ps1

# Start HEIDI only (assumes Ollama running)
.\Start-Heidi-Robust.ps1
```

## Production Considerations

### Port Configuration
- **Development**: Port 3458 (localhost only)
- **Production**: Consider reverse proxy (nginx/traefik) on port 443

### Firewall Setup
```powershell
# Allow localhost only (default)
# HEIDI binds to ::1 (IPv6 localhost) - secure by default

# For mobile access, use tunnel:
ngrok http 3458
# or
cloudflared tunnel --url http://localhost:3458
```

### Environment Variables
```powershell
# Create .env file
$env:HEIDI_PORT = "3458"
$env:OLLAMA_URL = "http://127.0.0.1:11434"
$env:HEIDI_SECRET = "your-secret-key"
```

### Mobile UI Integration
The mobile web UI should connect to:
- **Local**: `http://localhost:3458`
- **Tunnel**: `https://your-tunnel-url.ngrok.io`

### Health Check Endpoint
```
GET /health
Returns: { status, model, sessions, tasks, time }
```

### Security Notes
- No external exposure by default
- Consider API key for mobile access
- Rate limiting for voice endpoints
- HTTPS in production (tunnel or reverse proxy)

## Monitoring
- Logs: Console output (consider file logging for prod)
- Health: `/health` endpoint
- Metrics: Request counts in response headers
