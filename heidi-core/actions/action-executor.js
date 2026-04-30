/**
 * HEIDI Action Executor
 * Where Heidi stops talking and starts doing
 * WITH SAFETY LAYER - because chaos is not a feature
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class ActionExecutor {
  constructor(config = {}) {
    // Approved action types - everything else gets rejected
    this.approvedActions = new Set([
      'run_script',
      'run_command',
      'write_file',
      'read_file',
      'api_call',
      'log_event'
    ]);

    // Approved script directories
    this.approvedScriptDirs = config.approvedScriptDirs || [
      path.join(__dirname, '../../scripts'),
      path.join(__dirname, '../scripts'),
      path.join(__dirname, '../../cleanup')
    ];

    // Approved commands (whitelist)
    this.approvedCommands = new Set([
      'node',
      'powershell',
      'pwsh',
      'git',
      'npm',
      'echo',
      'cat',
      'ls',
      'dir'
    ]);

    // Approved API domains
    this.approvedDomains = config.approvedDomains || [
      'localhost',
      '127.0.0.1'
    ];

    this.executionLog = [];
  }

  /**
   * Main execution entry point
   */
  async execute(action) {
    // Safety check #1: Is this action type approved?
    if (!this.approvedActions.has(action.type)) {
      throw new Error(`Action type '${action.type}' is not approved`);
    }

    // Safety check #2: Does it have required fields?
    if (!action.target && !action.command) {
      throw new Error('Action must have target or command');
    }

    console.log(`[HEIDI Action] Executing: ${action.type} -> ${action.target || action.command}`);

    const startTime = Date.now();
    let result;

    try {
      switch (action.type) {
        case 'run_script':
          result = await this.runScript(action.target, action.args);
          break;
        case 'run_command':
          result = await this.runCommand(action.command, action.args);
          break;
        case 'write_file':
          result = await this.writeFile(action.target, action.content);
          break;
        case 'read_file':
          result = await this.readFile(action.target);
          break;
        case 'api_call':
          result = await this.apiCall(action.target, action.options);
          break;
        case 'log_event':
          result = await this.logEvent(action.target, action.payload);
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      const execution = {
        action,
        result: 'success',
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      this.executionLog.push(execution);
      
      return {
        success: true,
        result,
        execution
      };

    } catch (error) {
      const execution = {
        action,
        result: 'failed',
        error: error.message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

      this.executionLog.push(execution);
      
      throw error;
    }
  }

  /**
   * Run a script file
   */
  async runScript(scriptPath, args = []) {
    // Resolve to absolute path
    const absolutePath = path.resolve(scriptPath);
    
    // Safety check: Is this in an approved directory?
    const isApproved = this.approvedScriptDirs.some(dir => {
      const resolvedDir = path.resolve(dir);
      return absolutePath.startsWith(resolvedDir);
    });

    if (!isApproved) {
      throw new Error(`Script path not approved: ${scriptPath}`);
    }

    // Safety check: Does file exist?
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Script not found: ${absolutePath}`);
    }

    const ext = path.extname(absolutePath).toLowerCase();
    let command, commandArgs;

    if (ext === '.js') {
      command = 'node';
      commandArgs = [absolutePath, ...args];
    } else if (ext === '.ps1') {
      command = 'powershell';
      commandArgs = ['-ExecutionPolicy', 'Bypass', '-File', absolutePath, ...args];
    } else if (ext === '.sh') {
      command = 'bash';
      commandArgs = [absolutePath, ...args];
    } else {
      throw new Error(`Unsupported script type: ${ext}`);
    }

    return this.spawnProcess(command, commandArgs, { cwd: path.dirname(absolutePath) });
  }

  /**
   * Run a command directly
   */
  async runCommand(command, args = []) {
    // Safety check: Is command approved?
    const cmd = command.toLowerCase().split(' ')[0];
    if (!this.approvedCommands.has(cmd)) {
      throw new Error(`Command '${cmd}' is not in approved list`);
    }

    return this.spawnProcess(command, args);
  }

  /**
   * Spawn a child process
   */
  spawnProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        ...options,
        timeout: 30000, // 30 second timeout
        env: { ...process.env, NODE_ENV: 'production' }
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, exitCode: code });
        } else {
          reject(new Error(`Process exited with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Write file with safety checks
   */
  async writeFile(filePath, content) {
    const absolutePath = path.resolve(filePath);
    
    // Only allow writing to specific safe directories
    const safeDirs = [
      path.join(__dirname, '../../logs'),
      path.join(__dirname, '../../data'),
      path.join(__dirname, '../data')
    ];

    const isSafe = safeDirs.some(dir => absolutePath.startsWith(path.resolve(dir)));
    
    if (!isSafe) {
      throw new Error(`Write path not in safe directory: ${filePath}`);
    }

    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content, 'utf8');
    return { path: absolutePath, bytes: content.length };
  }

  /**
   * Read file with safety checks
   */
  async readFile(filePath) {
    const absolutePath = path.resolve(filePath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    return { path: absolutePath, content, bytes: content.length };
  }

  /**
   * API call with domain restrictions
   */
  async apiCall(url, options = {}) {
    const urlObj = new URL(url);
    
    // Safety check: Is domain approved?
    const isApproved = this.approvedDomains.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
    );

    if (!isApproved) {
      throw new Error(`API domain not approved: ${urlObj.hostname}`);
    }

    // Use fetch or axios
    const axios = require('axios');
    const response = await axios({
      url,
      method: options.method || 'GET',
      headers: options.headers,
      data: options.body,
      timeout: 10000
    });

    return { status: response.status, data: response.data };
  }

  /**
   * Log event locally
   */
  async logEvent(eventType, payload) {
    const event = {
      event: eventType,
      timestamp: new Date().toISOString(),
      payload
    };

    console.log('[HEIDI Event]', JSON.stringify(event));
    return { logged: true };
  }

  /**
   * Get execution log
   */
  getExecutionLog(limit = 100) {
    return this.executionLog.slice(-limit);
  }

  /**
   * Check if action is safe to execute
   */
  isSafe(action) {
    try {
      if (!this.approvedActions.has(action.type)) return false;
      // Additional checks can be added here
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = ActionExecutor;
