/**
 * HEIDI Setup Script
 * Quick setup for first run
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧠 HEIDI Setup');
console.log('===============\n');

// Check Node version
const nodeVersion = process.version;
console.log(`Node.js version: ${nodeVersion}`);

if (!fs.existsSync('.env')) {
  console.log('Creating .env from .env.example...');
  fs.copyFileSync('.env.example', '.env');
  console.log('✓ .env created - please edit it with your settings\n');
} else {
  console.log('✓ .env already exists\n');
}

// Create data directory
if (!fs.existsSync('data')) {
  console.log('Creating data directory...');
  fs.mkdirSync('data', { recursive: true });
  console.log('✓ data/ directory created\n');
}

// Check if Ollama is installed
console.log('Checking Ollama...');
try {
  execSync('ollama --version', { stdio: 'ignore' });
  console.log('✓ Ollama is installed\n');
  
  // Check if llama3 is available
  try {
    const models = execSync('ollama list', { encoding: 'utf8' });
    if (models.includes('llama3')) {
      console.log('✓ llama3 model available\n');
    } else {
      console.log('⚠ llama3 not found. Pull it with:');
      console.log('  ollama pull llama3\n');
    }
  } catch (e) {
    console.log('⚠ Could not check models\n');
  }
} catch (e) {
  console.log('✗ Ollama not found. Install it:');
  console.log('  https://ollama.com/download\n');
}

console.log('Next steps:');
console.log('  1. Edit .env with your settings');
console.log('  2. npm install');
console.log('  3. npm start');
console.log('  4. Test: curl http://localhost:3456/health');
console.log('\nHEIDI will be ready to think.\n');
