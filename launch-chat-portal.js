// Launch script for ProtoForge Chat Portal
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Launching ProtoForge Chat Portal...\n');

// Start the server
const server = spawn('node', ['src/server.js'], {
  stdio: 'inherit',
  cwd: __dirname
});

// Wait a moment for server to start
setTimeout(() => {
  console.log('\n🌐 Opening chat portals...\n');
  
  // Open main chat portal
  const url = 'http://localhost:3005/ursula-chat-portal.html';
  
  // Platform-specific open command
  const openCmd = process.platform === 'win32' ? 'start' :
                  process.platform === 'darwin' ? 'open' : 'xdg-open';
  
  spawn(openCmd, [url], { stdio: 'ignore' });
  
  console.log(`✅ Chat Portal: ${url}`);
  console.log(`✅ Dashboard: http://localhost:3005/`);
  console.log(`✅ Events Stream: http://localhost:3005/events/stream`);
  
  console.log('\n📡 WebSocket Endpoints:');
  console.log('   ws://localhost:3005/ws/ursula');
  console.log('   ws://localhost:3005/ws/heidi');
  console.log('   ws://localhost:3005/ws/cascade');
  console.log('   ws://localhost:3005/ws/kilo');
  console.log('   ws://localhost:3005/ws/protoforge');
  console.log('   ws://localhost:3005/ws/hyve');
  console.log('   ws://localhost:3005/ws/infrastructure');
  
  console.log('\n💬 Available Systems:');
  console.log('   🔮 Ursula - Event Stream Manager');
  console.log('   🧠 Heidi - Contextual Conscience');
  console.log('   ⚡ CASCADE - Event Processing');
  console.log('   🔧 KILO - Repair Hypotheses');
  console.log('   🌐 ProtoForge - Core System');
  console.log('   🐝 Hyve - Opportunity Collective');
  console.log('   🏗️ Infrastructure - System Health');
  
  console.log('\n✨ Chat with any system by selecting it in the sidebar!');
  
}, 2000);

// Handle server shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down server...');
  server.kill('SIGINT');
  process.exit(0);
});

server.on('close', (code) => {
  console.log(`\nServer exited with code ${code}`);
  process.exit(code);
});
