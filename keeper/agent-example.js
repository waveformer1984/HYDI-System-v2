/**
 * Example: How agents interact with KEEPER
 * Agents NEVER see secrets - they only request actions
 */

class AgentClient {
  constructor(agentId, keeperUrl = 'http://localhost:3001') {
    this.agentId = agentId;
    this.keeperUrl = keeperUrl;
  }

  /**
   * Execute an action through KEEPER
   */
  async execute(action, payload = {}) {
    const request = {
      action,
      payload,
      secretRef: this.getSecretRef(action)
    };

    const response = await fetch(`${this.keeperUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent: this.agentId,
        request
      })
    });

    return response.json();
  }

  /**
   * Map actions to secret references
   */
  getSecretRef(action) {
    const mapping = {
      'stripe:create_connect_account': 'stripe/live_key',
      'stripe:transfer': 'stripe/live_key',
      'stripe:retrieve_account': 'stripe/live_key',
      'stripe:list_accounts': 'stripe/live_key',
      'email:send_payout_notification': 'email/resend_key',
      'webhook:verify': 'stripe/webhook_secret'
    };

    return mapping[action] || null;
  }
}

// Example: Finance Agent
class FinanceAgent extends AgentClient {
  constructor() {
    super('finance-agent');
  }

  async createConnectAccount(clientData) {
    console.log('[Finance Agent] Creating Connect account...');
    
    const result = await this.execute('stripe:create_connect_account', {
      type: 'express',
      country: 'US',
      email: clientData.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_profile: {
        name: clientData.businessName,
        url: clientData.website
      },
      metadata: {
        client_id: clientData.clientId,
        project_name: clientData.projectName
      }
    });

    if (result.success) {
      console.log('✅ Connect account created:', result.data.id);
      return result.data;
    } else {
      console.error('❌ Failed to create account:', result.error);
      throw new Error(result.error);
    }
  }

  async processPayout(payoutData) {
    console.log('[Finance Agent] Processing payout...');
    
    const result = await this.execute('stripe:transfer', {
      amount: Math.round(payoutData.amount * 100), // Convert to cents
      currency: 'usd',
      destination: payoutData.connectAccountId,
      metadata: {
        payout_id: payoutData.payoutId,
        client_id: payoutData.clientId
      }
    });

    if (result.success) {
      console.log('✅ Transfer initiated:', result.data.id);
      return result.data;
    } else {
      console.error('❌ Transfer failed:', result.error);
      throw new Error(result.error);
    }
  }

  async getAccount(accountId) {
    console.log('[Finance Agent] Retrieving account...');
    
    const result = await this.execute('stripe:retrieve_account', {
      accountId
    });

    return result.success ? result.data : null;
  }
}

// Example: Heidi Agent
class HeidiAgent extends AgentClient {
  constructor() {
    super('heidi-agent');
  }

  async verifyWebhook(signature, body) {
    console.log('[Heidi Agent] Verifying webhook...');
    
    const result = await this.execute('webhook:verify', {
      signature,
      body,
      timestamp: Math.floor(Date.now() / 1000)
    });

    return result.success ? result.data.valid : false;
  }

  async sendAlert(message, recipient) {
    console.log('[Heidi Agent] Sending alert...');
    
    const result = await this.execute('email:send_alert', {
      to: recipient,
      subject: 'ProtoForge Alert',
      body: message
    });

    return result.success;
  }
}

// Usage examples
async function demonstrateUsage() {
  console.log('🤖 Agent-Keeper Interaction Examples');
  console.log('====================================\n');

  // Finance Agent Example
  console.log('1. Finance Agent creating Connect account:');
  const financeAgent = new FinanceAgent();
  
  try {
    const account = await financeAgent.createConnectAccount({
      clientId: 'client-123',
      email: 'client@example.com',
      businessName: 'Test Business',
      website: 'https://example.com'
    });
    
    console.log('   Account ID:', account.id);
    console.log('   Capabilities:', account.capabilities);
  } catch (err) {
    console.log('   Error:', err.message);
  }

  // Heidi Agent Example
  console.log('\n2. Heidi Agent verifying webhook:');
  const heidiAgent = new HeidiAgent();
  
  const isValid = await heidiAgent.verifyWebhook(
    't=1234567890,abc123...',
    '{"type": "account.updated"}'
  );
  
  console.log('   Webhook valid:', isValid);

  console.log('\n✅ Examples complete');
  console.log('\n💡 Key points:');
  console.log('   - Agents NEVER see API keys');
  console.log('   - All secret operations go through KEEPER');
  console.log('   - Results are sanitized before returning');
  console.log('   - All actions are audited');
}

// Run if executed directly
if (require.main === module) {
  demonstrateUsage().catch(console.error);
}

module.exports = { AgentClient, FinanceAgent, HeidiAgent };
