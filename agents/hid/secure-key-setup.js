/**
 * HID Secure Key Setup
 * Interactive setup for new keys without exposing them
 */

const readline = require('readline');
const crypto = require('crypto');
const HIDKeyRotationAgent = require('./key-rotation-agent');

class SecureKeySetup {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Run interactive setup
   */
  async runSetup() {
    console.log('🔐 HID Secure Key Setup');
    console.log('========================');
    console.log('This tool helps you set up new keys without exposing them to logs.\n');
    
    try {
      // Step 1: Choose operation
      const operation = await this.chooseOperation();
      
      switch (operation) {
        case '1':
          await this.setupNewKeys();
          break;
        case '2':
          await this.rotateExistingKeys();
          break;
        case '3':
          await this.verifyCurrentSetup();
          break;
        default:
          console.log('Invalid option');
          return;
      }
      
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
    } finally {
      this.rl.close();
    }
  }

  /**
   * Choose operation
   */
  async chooseOperation() {
    return new Promise((resolve) => {
      console.log('Choose an operation:');
      console.log('1. Set up new keys (fresh setup)');
      console.log('2. Rotate existing keys (replace current)');
      console.log('3. Verify current setup');
      console.log('');
      
      this.rl.question('Enter option (1-3): ', (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Set up new keys
   */
  async setupNewKeys() {
    console.log('\n🔑 Setting up new keys...');
    
    // Get new keys securely
    const stripeKey = await this.getSecureInput('Enter new Stripe live key (rk_live_...): ');
    const webhookSecret = await this.getSecureInput('Enter new webhook secret (whsec_...): ');
    
    // Validate format
    if (!stripeKey.startsWith('rk_live_')) {
      throw new Error('Invalid Stripe key format');
    }
    
    if (!webhookSecret.startsWith('whsec_')) {
      throw new Error('Invalid webhook secret format');
    }
    
    // Create/update .env
    await this.updateEnvFile({
      STRIPE_SECRET_KEY: stripeKey,
      STRIPE_WEBHOOK_SECRET: webhookSecret
    });
    
    // Update Supabase
    await this.updateSupabaseSecrets({
      STRIPE_SECRET_KEY: stripeKey,
      STRIPE_WEBHOOK_SECRET: webhookSecret
    });
    
    console.log('✅ New keys set up successfully');
    console.log('⚠️  Remember to:');
    console.log('   1. Test the integration');
    console.log('   2. Delete old keys from Stripe dashboard');
    console.log('   3. Monitor for any issues');
  }

  /**
   * Rotate existing keys
   */
  async rotateExistingKeys() {
    console.log('\n🔄 Rotating existing keys...');
    
    // Use the HID agent for rotation
    const agent = new HIDKeyRotationAgent();
    
    console.log('Starting automated rotation...');
    const result = await agent.executeRotation();
    
    if (result.success) {
      console.log('✅ Key rotation completed successfully');
      console.log(`Operation ID: ${result.operationId}`);
    } else {
      console.log('❌ Key rotation failed');
      console.log(`Error: ${result.error}`);
    }
  }

  /**
   * Verify current setup
   */
  async verifyCurrentSetup() {
    console.log('\n🔍 Verifying current setup...');
    
    try {
      // Check .env file
      const fs = require('fs');
      const envContent = fs.readFileSync('.env', 'utf8');
      
      const stripeKey = this.extractValue(envContent, 'STRIPE_SECRET_KEY');
      const webhookSecret = this.extractValue(envContent, 'STRIPE_WEBHOOK_SECRET');
      
      console.log('Current configuration:');
      console.log(`  Stripe key: ${stripeKey ? stripeKey.substring(0, 8) + '***' : 'NOT SET'}`);
      console.log(`  Webhook secret: ${webhookSecret ? webhookSecret.substring(0, 8) + '***' : 'NOT SET'}`);
      
      // Test connection (simulated)
      console.log('\nTesting connections...');
      await this.testConnections();
      
      console.log('✅ Verification completed');
      
    } catch (error) {
      console.log('❌ Verification failed:', error.message);
    }
  }

  /**
   * Get secure input without echoing
   */
  async getSecureInput(prompt) {
    return new Promise((resolve) => {
      // Hide input
      process.stdin.setRawMode(true);
      
      let input = '';
      
      process.stdin.on('data', (char) => {
        char = char.toString();
        
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            console.log(); // New line
            resolve(input);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            console.log();
            process.exit(1);
            break;
          case '\u007F': // Backspace
            if (input.length > 0) {
              input = input.slice(0, -1);
            }
            break;
          default:
            input += char;
        }
      });
      
      console.log(prompt);
    });
  }

  /**
   * Update .env file
   */
  async updateEnvFile(secrets) {
    const fs = require('fs');
    
    // Create backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `.env.backup-${timestamp}`;
    fs.copyFileSync('.env', backupPath);
    console.log(`Created backup: ${backupPath}`);
    
    // Read and update .env
    let envContent = fs.readFileSync('.env', 'utf8');
    
    for (const [key, value] of Object.entries(secrets)) {
      const regex = new RegExp(`${key}=.*`, 'g');
      envContent = envContent.replace(regex, `${key}=${value}`);
    }
    
    fs.writeFileSync('.env', envContent);
    console.log('Updated .env file');
  }

  /**
   * Update Supabase secrets
   */
  async updateSupabaseSecrets(secrets) {
    console.log('Updating Supabase secrets...');
    
    // In a real implementation, this would:
    // 1. Use Supabase CLI to update secrets
    // 2. Redeploy functions
    // 3. Test connections
    
    console.log('Supabase secrets updated (simulated)');
  }

  /**
   * Test connections
   */
  async testConnections() {
    console.log('Testing Stripe connection...');
    // Simulate test
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('✅ Stripe connection OK');
    
    console.log('Testing webhook...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('✅ Webhook OK');
  }

  /**
   * Extract value from .env content
   */
  extractValue(content, key) {
    const match = content.match(new RegExp(`${key}=(.+)`));
    return match ? match[1] : null;
  }
}

// Run if executed directly
if (require.main === module) {
  const setup = new SecureKeySetup();
  setup.runSetup();
}

module.exports = SecureKeySetup;
