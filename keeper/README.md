# KEEPER - ProtoForge Secret Management System

> "If an agent can read your API keys, your system is already compromised. Congrats."

## 🛡️ Architecture

```
AGENTS (Heidi + others) 
        ↓
SECRET PROXY (Keeper Interface)
        ↓
SECURE VAULT (Encrypted Storage)
        ↓
ACTION EXECUTION LAYER (Signed Requests)
```

## 🚀 Quick Start

```bash
# Install dependencies
cd keeper
npm install

# Start KEEPER server
npm start

# In another terminal, test agent interactions
npm test
```

## 📋 Core Principles

1. **Agents never see secrets** - They only request actions
2. **Secrets are encrypted at rest** - AES-256 encryption
3. **All actions are audited** - Never logs raw secrets
4. **Short-lived tokens** - 5-15 minute TTL for SSE
5. **Policy-based access** - Whitelist approach, not blacklist

## 🔐 Secret Storage

### Supported Backends
- HashiCorp Vault (recommended)
- AWS Secrets Manager
- GCP Secret Manager
- Encrypted Postgres (fallback)

### Secret References
Agents use references, NOT raw keys:

```javascript
// ❌ BAD
const stripe = new Stripe('sk_live_abc123...');

// ✅ GOOD
const result = await keeper.execute('stripe:transfer', {
  amount: 5000,
  destination: 'acct_123'
});
```

## 🤖 Agent Integration

### Finance Agent Example
```javascript
const FinanceAgent = require('./agent-example').FinanceAgent;

const agent = new FinanceAgent();

// Create Connect account (never sees the API key)
const account = await agent.createConnectAccount({
  email: 'client@example.com',
  businessName: 'Client Corp'
});

// Process payout
await agent.processPayout({
  amount: 1000.00,
  connectAccountId: account.id
});
```

## 📊 API Endpoints

### Execute Action (Agents)
```http
POST /execute
{
  "agent": "finance-agent",
  "request": {
    "action": "stripe:create_connect_account",
    "payload": { ... }
  }
}
```

### Issue Token
```http
POST /token
{
  "user": "heidi",
  "ttl": "10m"
}
```

### Audit Log
```http
GET /audit?agent=finance-agent
```

### Policy Info
```http
GET /policy/finance-agent
```

## 🔧 Configuration

Environment variables:
```bash
PORT=3001
KeeperEncryptionKey=your-32-byte-hex-key
```

## 🔄 Key Rotation

Automatic rotation checks:
```bash
npm run rotate-secrets
```

Manual rotation:
```javascript
await vault.rotate('stripe/live_key');
```

## 📝 Audit Trail

Every action logs:
```json
{
  "requestId": "abc123",
  "agent": "finance-agent",
  "action": "stripe:transfer",
  "timestamp": "2024-01-01T00:00:00Z",
  "status": "success"
}
```

**NEVER logs:**
- Raw API keys
- Tokens
- Secrets

## 🛡️ Security Features

1. **Encryption**: AES-256-GCM at rest
2. **Authentication**: JWT tokens with short TTL
3. **Authorization**: Policy-based permissions
4. **Rate Limiting**: Per-agent configurable limits
5. **Audit Logging**: Complete audit trail
6. **Sanitization**: All responses stripped of secrets

## 🚨 Failure Modes

What happens if:
- Agent tries to read secrets → Blocked by policy
- Secrets logged → Impossible (never passed to agents)
- Token reused → Expired after 15 minutes max
- Key not rotated → Auto-checks and alerts

## 📦 Production Deployment

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

### Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: keeper
spec:
  replicas: 3
  selector:
    matchLabels:
      app: keeper
  template:
    spec:
      containers:
      - name: keeper
        image: protoforge/keeper:latest
        ports:
        - containerPort: 3001
        env:
        - name: KeeperEncryptionKey
          valueFrom:
            secretKeyRef:
              name: keeper-secrets
              key: encryption-key
```

## 🔍 Monitoring

Metrics to track:
- Request volume per agent
- Failed authentications
- Rate limit hits
- Secret rotation status
- Vault health

## 📚 Integration Examples

See `agent-example.js` for complete examples of:
- Finance Agent (Stripe operations)
- Heidi Agent (Webhooks, alerts)
- Generic Agent Client

## 🎯 Final Truth

You're not building a "secret agent."

You're building a system that assumes everything will eventually be attacked and still doesn't fall apart.

If ProtoForge becomes what you want it to be, this layer is:

- the difference between scaling safely
- and becoming a very expensive cautionary tale

---

*"Most people only learn this after leaking something important. You're just skipping that step."*
