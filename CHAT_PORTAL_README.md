# ProtoForge Chat Portal

A unified command interface for communicating with all ProtoForge systems - Heidi, Ursula, CASCADE, KILO, and more.

## 🚀 Quick Start

### Option 1: Launch Script (Recommended)
```bash
node launch-chat-portal.js
```
This will start the server and automatically open the chat portal in your browser.

### Option 2: Manual Start
```bash
# Start the server
npm start

# Open in browser
http://localhost:3005/ursula-chat-portal.html
```

## 🌐 Access Points

- **Chat Portal**: http://localhost:3005/chat
- **Dashboard**: http://localhost:3005/
- **Events Stream**: http://localhost:3005/events/stream

## 💬 Available Systems

### 🔮 Ursula - Event Stream Manager
Manages event streams and routing between systems.
- **Commands**: `status`, `stream`, `broadcast <message>`
- **WebSocket**: `ws://localhost:3005/ws/ursula`

### 🧠 Heidi - Contextual Conscience
Monitors system ethics and provides contextual advice.
- **Commands**: `risk`, `advice`, `analyze`
- **WebSocket**: `ws://localhost:3005/ws/heidi`

### ⚡ CASCADE - Event Processing System
Processes and classifies events with confidence scoring.
- **Commands**: `process <event>`, `status`, `quarantine`
- **WebSocket**: `ws://localhost:3005/ws/cascade`

### 🔧 KILO - Repair Hypothesis Engine
Generates and validates repair hypotheses.
- **Commands**: `hypothesis`, `validate`, `manifest`
- **WebSocket**: `ws://localhost:3005/ws/kilo`

### 🌐 ProtoForge - Core System
Coordinates all system modules and governance.
- **Commands**: `status`, `modules`, `govern`
- **WebSocket**: `ws://localhost:3005/ws/protoforge`

### 🐝 Hyve - Opportunity Collective
Swarm intelligence for optimization opportunities.
- **Commands**: `opportunity`, `collective`, `swarm`
- **WebSocket**: `ws://localhost:3005/ws/hyve`

### 🏗️ Infrastructure - System Health Monitor
Monitors system resources and health metrics.
- **Commands**: `health`, `resources`, `alerts`
- **WebSocket**: `ws://localhost:3005/ws/infrastructure`

## 📡 WebSocket API

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3005/ws/ursula');
```

### Message Format
```json
{
  "type": "message",
  "content": "Your message here"
}
```

### Response Format
```json
{
  "type": "message",
  "sender": "ursula",
  "content": "Response from system",
  "timestamp": "2026-04-21T..."
}
```

## 🎯 Features

### Real-time Communication
- WebSocket connections for instant messaging
- System-specific channels
- Connection status indicators

### Quick Commands
- Pre-defined command buttons for common queries
- Auto-completion support
- Command history

### Multi-System Support
- Switch between systems seamlessly
- Each system maintains its own context
- Broadcast messages to all systems

### Status Monitoring
- Real-time connection status
- Message count tracking
- System uptime display

## 🔧 Architecture

```
Browser (Chat Portal)
       ↓
   HTTP/WebSocket
       ↓
   Express Server
       ↓
   System Handlers
       ↓
   ProtoForge Modules
```

## 📝 Message Flow

1. User types message in chat portal
2. Message sent via WebSocket to server
3. Server routes to appropriate system handler
4. System processes message and generates response
5. Response sent back via WebSocket
6. Displayed in chat portal

## 🚨 Troubleshooting

### WebSocket Connection Issues
- Ensure server is running on port 3005
- Check firewall settings
- Verify WebSocket URL format

### System Not Responding
- Check server logs for errors
- Verify system module is loaded
- Try refreshing the page

### Messages Not Sending
- Check WebSocket connection status
- Verify message format is correct JSON
- Check browser console for errors

## 🔮 Future Enhancements

- [ ] Message history persistence
- [ ] File/image sharing support
- [ ] Voice commands
- [ ] Mobile responsive design
- [ ] System-to-system messaging
- [ ] Command scheduling
- [ ] Alert notifications
- [ ] Multi-user support

## 📚 API Documentation

### REST API Endpoint
```
POST /api/chat
Content-Type: application/json

{
  "message": "Your message",
  "system": "ursula"
}
```

### WebSocket Endpoints
- `/ws/ursula` - Ursula system
- `/ws/heidi` - Heidi system
- `/ws/cascade` - CASCADE system
- `/ws/kilo` - KILO system
- `/ws/protoforge` - ProtoForge core
- `/ws/hyve` - Hyve collective
- `/ws/infrastructure` - Infrastructure monitor

## 🤝 Contributing

To add a new system to the chat portal:

1. Add handler in `api/chat/route.js`
2. Add WebSocket handler in `modules/chat-websocket-server.js`
3. Add system button to `ursula-chat-portal.html`
4. Update documentation

## 📄 License

ProtoForge Chat Portal - Part of the ProtoForge System
Copyright 2026 - ProtoForge Team
