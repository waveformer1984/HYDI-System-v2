#!/usr/bin/env node
/**
 * Interactive Supabase Credential Updater
 * Helps you update your .env file with real Supabase credentials
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

class CredentialUpdater {
  constructor() {
    this.envPath = path.join(__dirname, '.env');
    this.backupPath = path.join(__dirname, '.env.backup');
    this.credentials = {};
  }

  async updateCredentials() {
    console.log('🔧 Supabase Credential Updater\n');
    console.log('This will help you update your .env file with real Supabase credentials.\n');

    // Read current .env
    let envContent = '';
    try {
      envContent = fs.readFileSync(this.envPath, 'utf8');
      console.log('📄 Current .env file loaded');
    } catch (error) {
      console.log('❌ Could not read .env file');
      return false;
    }

    // Create backup
    try {
      fs.writeFileSync(this.backupPath, envContent);
      console.log('💾 Backup created: .env.backup');
    } catch (error) {
      console.log('⚠️  Could not create backup');
    }

    // Get new credentials
    console.log('\n📋 Please provide your Supabase credentials:');
    console.log('You can find these in your Supabase Dashboard → Settings → API\n');

    const supabaseUrl = await this.askQuestion('Supabase URL (e.g., https://your-project-id.supabase.co)');
    const serviceRoleKey = await this.askQuestion('Service Role Key (starts with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...)');
    const anonKey = await this.askQuestion('Anon/Public Key (also starts with eyJ...)');

    // Validate inputs
    if (!supabaseUrl.includes('supabase.co')) {
      console.log('❌ Invalid Supabase URL format');
      return false;
    }

    if (!serviceRoleKey.startsWith('eyJ') || !anonKey.startsWith('eyJ')) {
      console.log('❌ Invalid key format - keys should start with eyJ...');
      return false;
    }

    // Update .env content
    let updatedContent = envContent;

    // Replace URL
    updatedContent = updatedContent.replace(
      /SUPABASE_URL=.*$/gm,
      `SUPABASE_URL="${supabaseUrl}"`
    );
    updatedContent = updatedContent.replace(
      /NEXT_PUBLIC_SUPABASE_URL=.*$/gm,
      `NEXT_PUBLIC_SUPABASE_URL="${supabaseUrl}"`
    );

    // Replace service role key
    updatedContent = updatedContent.replace(
      /SUPABASE_SERVICE_ROLE_KEY=.*$/gm,
      `SUPABASE_SERVICE_ROLE_KEY="${serviceRoleKey}"`
    );

    // Replace anon key
    updatedContent = updatedContent.replace(
      /SUPABASE_ANON_KEY=.*$/gm,
      `SUPABASE_ANON_KEY="${anonKey}"`
    );
    updatedContent = updatedContent.replace(
      /SUPABASE_PUBLISHABLE_KEY=.*$/gm,
      `SUPABASE_PUBLISHABLE_KEY="${anonKey}"`
    );

    // Write updated .env
    try {
      fs.writeFileSync(this.envPath, updatedContent);
      console.log('\n✅ .env file updated successfully!');
      
      console.log('\n📋 Updated credentials:');
      console.log(`   URL: ${supabaseUrl}`);
      console.log(`   Service Role: ${serviceRoleKey.substring(0, 20)}...`);
      console.log(`   Anon Key: ${anonKey.substring(0, 20)}...`);
      
      return true;
      
    } catch (error) {
      console.log('❌ Failed to update .env file:', error.message);
      
      // Restore backup
      try {
        fs.copyFileSync(this.backupPath, this.envPath);
        console.log('🔄 Backup restored');
      } catch (restoreError) {
        console.log('❌ Could not restore backup');
      }
      
      return false;
    }
  }

  async askQuestion(question) {
    return new Promise((resolve) => {
      rl.question(`${question}: `, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  close() {
    rl.close();
  }
}

// Run the updater
async function main() {
  const updater = new CredentialUpdater();
  
  try {
    const success = await updater.updateCredentials();
    
    if (success) {
      console.log('\n🚀 Next steps:');
      console.log('   1. Test connection: node test-rpc-smoke.js');
      console.log('   2. Apply security patch: node apply-patch-simple.js');
      console.log('   3. Launch Heidi mobile: node launch-heidi-mobile.js');
      console.log('\n✨ Your Supabase credentials are now ready!');
    } else {
      console.log('\n❌ Credential update failed');
      console.log('Please check your inputs and try again');
    }
    
  } catch (error) {
    console.error('\n💥 Unexpected error:', error);
  } finally {
    updater.close();
  }
}

// Show manual instructions if they prefer
console.log('\n📖 Manual Option:');
console.log('If you prefer to update manually, edit your .env file and replace:');
console.log('   SUPABASE_URL="https://your-project.supabase.co"');
console.log('   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
console.log('   SUPABASE_ANON_KEY="your-anon-key"');
console.log('\nWith your actual Supabase project credentials.\n');

// Ask if they want to use interactive updater
rl.question('Use interactive credential updater? (y/n): ', (answer) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    main();
  } else {
    console.log('\n👍 Please update your .env file manually, then run:');
    console.log('   node test-rpc-smoke.js');
    rl.close();
  }
});
