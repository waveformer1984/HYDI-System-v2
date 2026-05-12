const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Git Wrapper for Windows compatibility
class GitWrapper {
  constructor(workDir) {
    this.workDir = workDir;
    this.gitDir = path.join(workDir, '.git');
  }

  async init() {
    console.log('Initializing Git repository (Windows compatibility mode)...');
    
    try {
      // Check if already initialized
      const gitExists = fs.existsSync(this.gitDir);
      console.log(`Git directory exists: ${gitExists} at ${this.gitDir}`);
      
      if (gitExists) {
        console.log('Git repository already exists');
        return true;
      }

      // Try different approaches
      const approaches = [
        () => this.execCommand('git init --shared=false'),
        () => this.execCommand('git init'),
        () => this.manualInit()
      ];

      for (let i = 0; i < approaches.length; i++) {
        try {
          console.log(`Trying approach ${i + 1}...`);
          await approaches[i]();
          console.log(`Git initialized successfully with approach ${i + 1}`);
          return true;
        } catch (error) {
          console.log(`Approach ${i + 1} failed: ${error.message}`);
          if (i === approaches.length - 1) {
            throw error;
          }
        }
      }

    } catch (error) {
      console.error('Git initialization failed:', error.message);
      return false;
    }
  }

  async manualInit() {
    console.log('Attempting manual git initialization...');
    
    // Create .git directory structure
    const gitStructure = {
      'objects': {},
      'refs': {},
      'refs/heads': {},
      'refs/tags': {},
      'info': {},
      'hooks': {}
    };

    // Create directories
    for (const [dir, content] of Object.entries(gitStructure)) {
      const fullPath = path.join(this.gitDir, dir);
      fs.mkdirSync(fullPath, { recursive: true });
      
      if (typeof content === 'object' && !Array.isArray(content)) {
        for (const subDir of Object.keys(content)) {
          fs.mkdirSync(path.join(fullPath, subDir), { recursive: true });
        }
      }
    }

    // Create basic config
    const config = `[core]
	repositoryformatversion = 0
	filemode = false
	bare = false
	logallrefupdates = true
	symlinks = false
	ignorecase = true
`;
    
    fs.writeFileSync(path.join(this.gitDir, 'config'), config);
    
    // Create HEAD file
    fs.writeFileSync(path.join(this.gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    
    // Create description file
    fs.writeFileSync(path.join(this.gitDir, 'description'), 'Unnamed repository; edit this file to name it.\n');
    
    // Execute git init to complete setup
    this.execCommand('git init');
  }

  execCommand(command) {
    try {
      const result = execSync(command, {
        cwd: this.workDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return result;
    } catch (error) {
      throw new Error(`Command failed: ${command} - ${error.message}`);
    }
  }

  async status() {
    try {
      return this.execCommand('git status --porcelain');
    } catch (error) {
      throw new Error(`Git status failed: ${error.message}`);
    }
  }

  async add(files = '.') {
    return this.execCommand(`git add ${files}`);
  }

  async commit(message) {
    return this.execCommand(`git commit -m "${message}"`);
  }

  async push(remote = 'origin', branch = 'main') {
    return this.execCommand(`git push ${remote} ${branch}`);
  }

  async addRemote(name, url) {
    return this.execCommand(`git remote add ${name} ${url}`);
  }

  async getCurrentBranch() {
    try {
      return this.execCommand('git branch --show-current').trim();
    } catch (error) {
      // Fallback for older git versions
      try {
        const result = this.execCommand('git rev-parse --abbrev-ref HEAD').trim();
        return result === 'HEAD' ? 'main' : result;
      } catch (fallbackError) {
        return 'main';
      }
    }
  }
}

// CLI interface
if (require.main === module) {
  const wrapper = new GitWrapper(process.cwd());
  const command = process.argv[2] || 'init';
  
  (async () => {
    switch (command) {
      case 'init':
        await wrapper.init();
        break;
      case 'status':
        console.log(await wrapper.status());
        break;
      default:
        console.log('Usage: node git-wrapper.js [init|status]');
    }
  })().catch(console.error);
}

module.exports = { GitWrapper };
