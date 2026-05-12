// HEIDI CLI - User Communication Layer
require('dotenv').config();

class HeidiCLI {
  constructor() {
    this.heidi = null;
    this.running = false;
    this.commands = new Map();
    
    this.commands.set('help', {
      description: 'Show available commands',
      handler: this.showHelp.bind(this)
    });
    
    this.commands.set('status', {
      description: 'Show system status',
      handler: this.showStatus.bind(this)
    });
    
    this.commands.set('query', {
      description: 'Query knowledge base',
      handler: this.queryKnowledgeBase.bind(this)
    });
    
    this.commands.set('scan', {
      description: 'Scan for assets',
      handler: this.scanCommand.bind(this)
    });
    
    this.commands.set('discover', {
      description: 'Discover system',
      handler: this.discoverCommand.bind(this)
    });
    
    this.commands.set('exit', {
      description: 'Exit CLI',
      handler: this.exitCommand.bind(this)
    });
  }

  async initialize() {
    console.log('=== HEIDI CLI INITIALIZATION ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Initialize HEIDI core
      await this.initializeHeidi();
      
      // Set up event handlers
      await this.setupEventHandlers();
      
      this.running = true;
      
      console.log('=== HEIDI CLI INITIALIZATION COMPLETE ===');
      console.log('Type "help" for available commands');
      
      return true;
      
    } catch (error) {
      console.log(`HEIDI CLI initialization failed: ${error.message}`);
      throw error;
    }
  }

  async initializeHeidi() {
    console.log('Initializing HEIDI core...');
    
    const { HeidiCore } = require('./heidi-core');
    this.heidi = new HeidiCore();
    
    await this.heidi.initialize();
    
    // Make HEIDI available globally
    global.heidi = this.heidi;
    
    console.log('HEIDI core initialized');
  }

  async setupEventHandlers() {
    console.log('Setting up event handlers...');
    
    // Subscribe to HEIDI events
    if (this.heidi) {
      await this.heidi.subscribe('heidi', async (event) => {
        console.log(`HEIDI Event: ${event.type}`);
        this.displayResponse(event);
      });
    }
    
    console.log('Event handlers set up');
  }

  async start() {
    console.log('=== HEIDI CLI STARTED ===');
    console.log('Welcome to HEIDI - ProtoForge Operational Intelligence Layer');
    console.log('Type "help" for available commands or enter your query');
    
    await this.initialize();
    
    // Start interactive mode
    await this.startInteractiveMode();
  }

  async startInteractiveMode() {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'HEIDI> '
    });
    
    rl.on('line', async (input) => {
      if (input.trim() === '') {
        rl.prompt();
        return;
      }
      
      try {
        await this.processInput(input);
      } catch (error) {
        console.log(`Error: ${error.message}`);
      }
      
      rl.prompt();
    });
    
    rl.on('close', () => {
      console.log('Goodbye!');
      process.exit(0);
    });
  }

  async processInput(input) {
    const trimmed = input.trim();
    
    // Check if it's a command
    const [command, ...args] = trimmed.split(' ');
    
    if (this.commands.has(command)) {
      const cmd = this.commands.get(command);
      await cmd.handler(args);
    } else {
      // Process as general query
      await this.processQuery(trimmed);
    }
  }

  async processQuery(query) {
    console.log(`Processing query: "${query}"`);
    
    if (this.heidi) {
      const result = await this.heidi.process(query);
      this.displayResponse(result);
    } else {
      console.log('HEIDI not available');
    }
  }

  displayResponse(response) {
    if (response.success) {
      console.log(`\n${response.type.toUpperCase()}:`);
      
      if (response.results && response.results.length > 0) {
        console.log(`Found ${response.results.length} results:`);
        response.results.forEach((result, index) => {
          console.log(`  ${index + 1}. ${result.name}`);
          if (result.preview) {
            console.log(`     ${result.preview}`);
          }
        });
      } else if (response.status) {
        console.log('Status:', JSON.stringify(response.status, null, 2));
      } else if (response.result) {
        console.log('Result:', JSON.stringify(response.result, null, 2));
      } else if (response.message) {
        console.log(response.message);
      }
    } else {
      console.log('Error:', response.error);
    }
  }

  // Command Handlers
  async showHelp(args) {
    console.log('\n=== HEIDI COMMANDS ===');
    
    for (const [command, cmd] of this.commands) {
      console.log(`  ${command.padEnd(10)} - ${cmd.description}`);
    }
    
    console.log('\nExamples:');
    console.log('  help                    - Show this help message');
    console.log('  status                  - Show system status');
    console.log('  query protoforge       - Query knowledge base');
    console.log('  scan example.com       - Scan example.com for assets');
    console.log('  discover                - Discover system components');
    console.log('  exit                    - Exit CLI');
    console.log('\nYou can also just type your query directly:');
    console.log('  What is ProtoForge?');
    console.log('  How do I scan for assets?');
    console.log('  Tell me about the system status');
  }

  async showStatus(args) {
    console.log('\n=== SYSTEM STATUS ===');
    
    if (this.heidi) {
      const status = await this.heidi.status();
      
      console.log(`Initialized: ${status.initialized ? 'YES' : 'NO'}`);
      console.log(`Connected: ${status.connected ? 'YES' : 'NO'}`);
      console.log(`Processing: ${status.processing ? 'YES' : 'NO'}`);
      console.log(`Last Activity: ${status.lastActivity}`);
      console.log(`Events Processed: ${status.eventCount}`);
      console.log(`Responses Generated: ${status.responseCount}`);
      
      if (status.systemMap) {
        console.log('\n=== SYSTEM MAP ===');
        console.log(`Paths: ${status.systemMap.totalPaths}`);
        console.log(`Modules: ${status.systemMap.totalModules}`);
        console.log(`Services: ${status.systemMap.totalServices}`);
        console.log(`Running Services: ${status.systemMap.runningServices}`);
      }
      
      if (status.knowledgeBase) {
        console.log('\n=== KNOWLEDGE BASE ===');
        console.log(`Entries: ${status.knowledgeBase}`);
      }
      
    } else {
      console.log('HEIDI not initialized');
    }
  }

  async queryKnowledgeBase(args) {
    const query = args.join(' ');
    
    console.log(`\nQuerying knowledge base for: "${query}"`);
    
    if (this.heidi) {
      // Use HEIDI's query method
      const result = await this.heidi.process(`query ${query}`);
      this.displayResponse(result);
    } else {
      console.log('HEIDI not available for querying');
    }
  }

  async scanCommand(args) {
    const url = args[0] || 'example.com';
    
    console.log(`\nScanning: ${url}`);
    
    if (this.heidi) {
      const result = await this.heidi.process(`run scan ${url}`);
      this.displayResponse(result);
    } else {
      console.log('HEIDI not available for scanning');
    }
  }

  async discoverCommand(args) {
    console.log('\n=== SYSTEM DISCOVERY ===');
    
    if (this.heidi) {
      const result = await this.heidi.process('discover system');
      this.displayResponse(result);
    } else {
      console.log('HEIDI not available for discovery');
    }
  }

  async exitCommand(args) {
    console.log('Exiting HEIDI CLI...');
    process.exit(0);
  }

  // Utility Methods
  async runCommand(command) {
    console.log(`Running command: ${command}`);
    
    const [cmd, ...args] = command.split(' ');
    
    if (this.commands.has(cmd)) {
      const handler = this.commands.get(cmd);
      await handler.handler(args);
    } else {
      await this.processQuery(command);
    }
  }

  getState() {
    return {
      running: this.running,
      commands: this.commands.size,
      heidi: this.heidi ? this.heidi.getStatus() : null
    };
  }
}

// CLI interface
if (require.main === module) {
  const cli = new HeidiCLI();
  
  // Handle command line arguments
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Run single command and exit
    cli.runCommand(args.join(' ')).catch(error => {
      console.log(`Error: ${error.message}`);
      process.exit(1);
    });
  } else {
    // Start interactive mode
    cli.start().catch(error => {
      console.log(`Error starting CLI: ${error.message}`);
      process.exit(1);
    });
  }
}

module.exports = { HeidiCLI };
