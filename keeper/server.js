/**
 * KEEPER Server - The Secret Proxy Service
 * Agents talk to this, never to secrets directly
 */

const express = require('express');
const Keeper = require('./index');
const Vault = require('./vault');
const PolicyEngine = require('./policy-engine');

class KeeperServer {
  constructor(port = 3001) {
    this.app = express();
    this.port = port;
    this.keeper = null;
    this.setupMiddleware();
    this.setupRoutes();
  }

  async initialize() {
    // Initialize components
    const vault = new Vault({
      encryptionKey: process.env.KeeperEncryptionKey || Vault.prototype.generateKey()
    });
    
    await vault.initialize();
    
    const policyEngine = new PolicyEngine();
    
    this.keeper = new Keeper(vault, policyEngine);
    
    console.log('[KEEPER] Server initialized');
  }

  setupMiddleware() {
    this.app.use(express.json());
    
    // Request logging (sanitized)
    this.app.use((req, res, next) => {
      console.log(`[KEEPER] ${req.method} ${req.path} from ${req.ip}`);
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'keeper', timestamp: new Date().toISOString() });
    });

    // Agent request handler
    this.app.post('/execute', async (req, res) => {
      try {
        const { agent, request, token } = req.body;
        
        // Validate request
        if (!agent || !request) {
          return res.status(400).json({
            error: 'Missing agent or request in payload'
          });
        }

        // Optional: Validate token for additional security
        if (token) {
          // Token validation logic here
        }

        // Process through KEEPER
        const result = await this.keeper.handle(request, agent);
        
        res.json(result);
        
      } catch (error) {
        console.error('[KEEPER] Error:', error);
        res.status(500).json({
          error: 'Internal server error',
          requestId: this.keeper?.generateRequestId()
        });
      }
    });

    // Issue short-lived token
    this.app.post('/token', async (req, res) => {
      try {
        const { user, ttl } = req.body;
        
        if (!user) {
          return res.status(400).json({ error: 'User required' });
        }

        const token = this.keeper.issueToken(user, ttl);
        
        res.json({ token, ttl: ttl || '10m' });
        
      } catch (error) {
        res.status(500).json({ error: 'Failed to issue token' });
      }
    });

    // Audit log endpoint (restricted)
    this.app.get('/audit', (req, res) => {
      const { agent } = req.query;
      
      // In production, add authentication
      const log = this.keeper?.getAuditLog(agent) || [];
      
      res.json({ 
        entries: log,
        total: log.length,
        timestamp: new Date().toISOString()
      });
    });

    // Policy info
    this.app.get('/policy/:agent', (req, res) => {
      const { agent } = req.params;
      const policy = this.keeper?.policyEngine.getPolicy(agent);
      
      if (!policy) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      res.json({ agent, policy });
    });
  }

  async start() {
    if (!this.keeper) {
      await this.initialize();
    }

    this.app.listen(this.port, () => {
      console.log(`[KEEPER] Server running on port ${this.port}`);
      console.log(`[KEEPER] Endpoints:`);
      console.log(`  POST /execute - Agent requests`);
      console.log(`  POST /token - Issue tokens`);
      console.log(`  GET /audit - Audit log`);
      console.log(`  GET /policy/:agent - View policies`);
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new KeeperServer(process.env.PORT || 3001);
  server.start().catch(console.error);
}

module.exports = KeeperServer;
