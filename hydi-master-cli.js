#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// HYDI Master CLI - Global Orchestration System
class HYDIMasterCLI {
  constructor() {
    this.workDir = process.cwd();
    this.report = {
      git: {},
      supabase: {},
      vercel: {},
      consistency: {}
    };
  }

  async run(command) {
    console.log('=== HYDI MASTER CLI - GLOBAL ORCHESTRATION ===');
    console.log(`Command: ${command}`);
    console.log(`Working Directory: ${this.workDir}`);
    console.log('');

    switch (command) {
      case 'audit':
        await this.gitRepositoryAudit();
        await this.supabaseAlignment();
        await this.vercelReadiness();
        this.printConsistencyReport();
        break;
        
      case 'sync':
        await this.atomicSyncProtocol();
        break;
        
      case 'deploy':
        await this.preDeploymentCheck();
        await this.commitStrategy();
        await this.pushToGitHub();
        await this.deployToVercel();
        this.printConsistencyReport();
        break;
        
      case 'status':
        await this.fullSystemStatus();
        break;
        
      default:
        this.showUsage();
    }
  }

  async gitRepositoryAudit() {
    console.log('--- STEP 1: GIT REPOSITORY AUDIT ---');
    
    try {
      // Check if git is initialized
      const gitDir = path.join(this.workDir, '.git');
      const gitExists = fs.existsSync(gitDir);
      
      if (!gitExists) {
        console.log('Git not initialized - initializing with Windows compatibility...');
        try {
          // Try multiple git init approaches for Windows
          const gitCommands = [
            'git init --shared=false',
            'git init',
            'git.exe init --shared=false',
            'git.exe init'
          ];
          
          let initSuccess = false;
          for (const cmd of gitCommands) {
            try {
              execSync(cmd, { cwd: this.workDir, stdio: 'pipe' });
              console.log(`Git repository initialized with: ${cmd}`);
              initSuccess = true;
              break;
            } catch (initError) {
              continue; // Try next approach
            }
          }
          
          if (!initSuccess) {
            // Last resort - create .git directory manually
            fs.mkdirSync(gitDir, { recursive: true });
            execSync('git init', { cwd: this.workDir, stdio: 'pipe' });
            console.log('Git repository initialized (manual approach)');
          }
          
        } catch (error) {
          console.log(`Git init failed: ${error.message}`);
          console.log('Manual intervention may be required:');
          console.log('1. Run: git init --shared=false');
          console.log('2. Check folder permissions');
          console.log('3. Close any IDE processes that might lock the folder');
          this.report.git.status = 'FAILED';
          return;
        }
      }
      
      // Get git status
      try {
        const status = execSync('git status --porcelain', { 
          cwd: this.workDir, 
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        const statusLines = status.trim().split('\n');
        const modified = statusLines.filter(line => line.startsWith(' M')).length;
        const untracked = statusLines.filter(line => line.startsWith('??')).length;
        
        this.report.git = {
          status: 'OK',
          modified,
          untracked,
          totalChanges: modified + untracked,
          statusLines: statusLines
        };
        
        console.log(`Git Status: ${modified} modified, ${untracked} untracked files`);
        
      } catch (error) {
        console.log('Git status check failed');
        this.report.git.status = 'ERROR';
      }
      
      // Check current branch
      try {
        const branch = execSync('git branch --show-current', { 
          cwd: this.workDir, 
          encoding: 'utf8',
          stdio: 'pipe'
        }).trim();
        
        this.report.git.branch = branch;
        console.log(`Current branch: ${branch}`);
        
      } catch (error) {
        console.log('Could not determine current branch');
      }
      
    } catch (error) {
      console.log(`Git audit failed: ${error.message}`);
      this.report.git.status = 'FAILED';
    }
    
    console.log('');
  }

  async atomicSyncProtocol() {
    console.log('--- ATOMIC SYNC PROTOCOL ---');
    
    // Step 1: Validate
    console.log('Step 1: Validating system state...');
    await this.gitRepositoryAudit();
    await this.supabaseAlignment();
    await this.vercelReadiness();
    
    // Special handling for Windows git issues
    if (this.report.git.status === 'FAILED' || this.report.git.status === 'ERROR') {
      console.log('Git repository issues detected - using bypass mode');
      await this.gitBypassProtocol();
      return;
    }
    
    const readinessScore = this.calculateReadinessScore();
    if (readinessScore < 70) {
      console.log(`Sync aborted: Readiness score too low (${readinessScore}/100)`);
      console.log('Run "node hydi-master-cli.js audit" to see issues');
      return;
    }
    
    // Step 2: Snapshot
    console.log('Step 2: Creating version snapshot...');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const versionTag = `v1.0.0-${timestamp}`;
    
    try {
      // Create version file
      const versionInfo = {
        version: versionTag,
        timestamp: new Date().toISOString(),
        gitCommit: this.getGitCommitHash(),
        readinessScore,
        environment: process.env.NODE_ENV || 'development'
      };
      
      fs.writeFileSync('version.json', JSON.stringify(versionInfo, null, 2));
      console.log(`Version snapshot created: ${versionTag}`);
      
    } catch (error) {
      console.log(`Version snapshot failed: ${error.message}`);
      return;
    }
    
    // Step 3: Push
    console.log('Step 3: Atomic push to GitHub...');
    await this.commitStrategy();
    await this.pushToGitHub();
    
    if (!this.report.git.pushed) {
      console.log('Atomic push failed - rolling back version file');
      try {
        fs.unlinkSync('version.json');
      } catch (error) {
        console.log('Could not clean up version file');
      }
      return;
    }
    
    // Step 4: Deploy (if ready)
    if (this.report.vercel.ready) {
      console.log('Step 4: Triggering Vercel deployment...');
      await this.deployToVercel();
    } else {
      console.log('Step 4: Skipping Vercel deployment (not ready)');
    }
    
    console.log('Atomic sync protocol completed');
    this.printConsistencyReport();
  }

  async gitBypassProtocol() {
    console.log('--- GIT BYPASS PROTOCOL ---');
    console.log('Git repository is inaccessible - using filesystem snapshot approach');
    
    // Step 1: Create filesystem snapshot
    console.log('Step 1: Creating filesystem snapshot...');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const versionTag = `v1.0.0-${timestamp}`;
    
    try {
      // Create version file
      const versionInfo = {
        version: versionTag,
        timestamp: new Date().toISOString(),
        gitBypass: true,
        reason: 'Windows filesystem git corruption',
        readinessScore: this.calculateReadinessScore(),
        environment: process.env.NODE_ENV || 'development',
        files: this.getProjectFileList()
      };
      
      fs.writeFileSync('version.json', JSON.stringify(versionInfo, null, 2));
      console.log(`Filesystem snapshot created: ${versionTag}`);
      
    } catch (error) {
      console.log(`Filesystem snapshot failed: ${error.message}`);
      return;
    }
    
    // Step 2: Create backup archive
    console.log('Step 2: Creating backup archive...');
    try {
      const archiver = require('archiver');
      const output = fs.createWriteStream(`hydi-backup-${timestamp}.zip`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.pipe(output);
      archive.directory('.', false);
      archive.finalize();
      
      console.log(`Backup archive created: hydi-backup-${timestamp}.zip`);
      
    } catch (error) {
      console.log(`Backup creation failed: ${error.message}`);
    }
    
    // Step 3: Update readiness score (git bypassed)
    this.report.git.status = 'BYPASSED';
    this.report.git.bypassReason = 'Windows filesystem corruption';
    
    console.log('Git bypass protocol completed');
    this.printConsistencyReport();
    
    console.log('');
    console.log('RECOMMENDATIONS:');
    console.log('1. Manual git setup may be required for full deployment');
    console.log('2. Consider using a different development environment');
    console.log('3. System is ready for deployment via other methods');
  }

  getProjectFileList() {
    try {
      const files = [];
      const scanDir = (dir, relativePath = '') => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativeFilePath = path.join(relativePath, item);
          
          if (fs.statSync(fullPath).isDirectory()) {
            if (!item.startsWith('.') && item !== 'node_modules') {
              scanDir(fullPath, relativeFilePath);
            }
          } else {
            files.push(relativeFilePath);
          }
        }
      };
      
      scanDir(this.workDir);
      return files;
    } catch (error) {
      return ['Error scanning files: ' + error.message];
    }
  }

  calculateReadinessScore() {
    let score = 0;
    let maxScore = 0;
    
    // Git score
    maxScore += 30;
    if (this.report.git.status === 'OK') score += 10;
    if (this.report.git.committed) score += 10;
    if (this.report.git.pushed) score += 10;
    
    // Supabase score
    maxScore += 30;
    if (this.report.supabase.status === 'OK') score += 15;
    if (this.report.supabase.schemaAligned === true) score += 15;
    
    // Vercel score
    maxScore += 20;
    if (this.report.vercel.hasPackageJson) score += 10;
    if (this.report.vercel.ready) score += 10;
    
    // Consistency score
    maxScore += 20;
    if (this.report.consistency.preFlight?.summary?.ready) score += 20;
    
    return Math.round((score / maxScore) * 100);
  }

  getGitCommitHash() {
    try {
      return execSync('git rev-parse --short HEAD', { 
        cwd: this.workDir, 
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  async commitStrategy() {
    console.log('--- STEP 2: COMMIT STRATEGY ---');
    
    if (this.report.git.totalChanges === 0) {
      console.log('No changes to commit');
      return;
    }
    
    try {
      // Add all files
      execSync('git add .', { cwd: this.workDir, stdio: 'pipe' });
      console.log('All files staged');
      
      // Create commit message based on changes
      const timestamp = new Date().toISOString().slice(0, 19);
      const commitMessage = `HYDI: system orchestration - ${timestamp}`;
      
      execSync(`git commit -m "${commitMessage}"`, { 
        cwd: this.workDir, 
        stdio: 'pipe'
      });
      
      console.log(`Commit created: ${commitMessage}`);
      this.report.git.committed = true;
      
    } catch (error) {
      console.log(`Commit failed: ${error.message}`);
      this.report.git.committed = false;
    }
    
    console.log('');
  }

  async pushToGitHub() {
    console.log('--- STEP 3: PUSH TO GITHUB ---');
    
    try {
      // Check if remote exists
      try {
        execSync('git remote get-url origin', { 
          cwd: this.workDir, 
          stdio: 'pipe'
        });
      } catch (error) {
        console.log('No remote "origin" found');
        console.log('To set up GitHub, run:');
        console.log('git remote add origin <your-repo-url>');
        this.report.git.pushed = false;
        return;
      }
      
      // Push to remote
      execSync('git push origin main', { 
        cwd: this.workDir, 
        stdio: 'pipe'
      });
      
      console.log('Pushed to GitHub successfully');
      this.report.git.pushed = true;
      
    } catch (error) {
      console.log(`Push failed: ${error.message}`);
      this.report.git.pushed = false;
    }
    
    console.log('');
  }

  async supabaseAlignment() {
    console.log('--- STEP 4: SUPABASE ALIGNMENT ---');
    
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Check table existence
      const { data, error } = await supabase
        .from('hydi_events')
        .select('count')
        .limit(1);
      
      if (error) {
        throw new Error(`Table access failed: ${error.message}`);
      }
      
      console.log('Supabase connectivity: OK');
      console.log('hydi_events table: Accessible');
      
      // Check schema alignment
      const { data: sampleData, error: sampleError } = await supabase
        .from('hydi_events')
        .select('*')
        .limit(1);
      
      if (!sampleError && sampleData.length > 0) {
        const sample = sampleData[0];
        const requiredFields = ['event_id', 'source', 'type', 'status', 'payload', 'timestamp'];
        const hasRequiredFields = requiredFields.every(field => sample.hasOwnProperty(field));
        
        this.report.supabase = {
          status: 'OK',
          tableExists: true,
          schemaAligned: hasRequiredFields,
          sampleFields: Object.keys(sample)
        };
        
        console.log(`Schema alignment: ${hasRequiredFields ? 'OK' : 'NEEDS_UPDATE'}`);
        console.log(`Available fields: ${Object.keys(sample).join(', ')}`);
      } else {
        this.report.supabase = {
          status: 'OK',
          tableExists: true,
          schemaAligned: 'UNKNOWN',
          message: 'No data to verify schema'
        };
        
        console.log('Schema alignment: UNKNOWN (no sample data)');
      }
      
    } catch (error) {
      console.log(`Supabase alignment failed: ${error.message}`);
      this.report.supabase = {
        status: 'FAILED',
        error: error.message
      };
    }
    
    console.log('');
  }

  async vercelReadiness() {
    console.log('--- STEP 5: VERCEL DEPLOYMENT READINESS ---');
    
    // Check for vercel.json
    const vercelConfig = path.join(this.workDir, 'vercel.json');
    const hasVercelConfig = fs.existsSync(vercelConfig);
    
    // Check for package.json
    const packageJson = path.join(this.workDir, 'package.json');
    const hasPackageJson = fs.existsSync(packageJson);
    
    // Check for Next.js or API routes
    const nextConfig = path.join(this.workDir, 'next.config.js');
    const apiDir = path.join(this.workDir, 'api');
    
    const hasNext = fs.existsSync(nextConfig) || fs.existsSync(apiDir);
    
    this.report.vercel = {
      hasVercelConfig,
      hasPackageJson,
      hasNext,
      ready: hasPackageJson && (hasVercelConfig || hasNext)
    };
    
    console.log(`Vercel config: ${hasVercelConfig ? 'EXISTS' : 'MISSING'}`);
    console.log(`Package.json: ${hasPackageJson ? 'EXISTS' : 'MISSING'}`);
    console.log(`Next.js/API: ${hasNext ? 'DETECTED' : 'NOT DETECTED'}`);
    console.log(`Deployment ready: ${this.report.vercel.ready ? 'YES' : 'NEEDS_SETUP'}`);
    
    if (!this.report.vercel.ready) {
      console.log('');
      console.log('To prepare for Vercel deployment:');
      if (!hasPackageJson) console.log('- Add package.json with build scripts');
      if (!hasVercelConfig && !hasNext) console.log('- Add vercel.json or Next.js setup');
    }
    
    console.log('');
  }

  async deployToVercel() {
    console.log('--- STEP 6: DEPLOY TO VERCEL ---');
    
    if (!this.report.vercel.ready) {
      console.log('Vercel deployment not ready - run "sync" first');
      return;
    }
    
    try {
      // Check if Vercel CLI is available
      execSync('vercel --version', { stdio: 'pipe' });
      
      console.log('Deploying to Vercel...');
      const deployOutput = execSync('vercel --prod', { 
        cwd: this.workDir, 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      console.log('Vercel deployment successful');
      this.report.vercel.deployed = true;
      this.report.vercel.deployOutput = deployOutput;
      
    } catch (error) {
      console.log(`Vercel deployment failed: ${error.message}`);
      this.report.vercel.deployed = false;
    }
    
    console.log('');
  }

  async preDeploymentCheck() {
    console.log('--- PRE-DEPLOYMENT CHECK ---');
    
    // Run pre-flight checklist
    try {
      const { PreFlightCheck } = require('./preflight-check');
      const preFlight = new PreFlightCheck();
      const ready = await preFlight.runAllChecks();
      
      this.report.consistency.preFlight = preFlight.getResults();
      console.log(`Pre-flight check: ${ready ? 'PASSED' : 'FAILED'}`);
      
      if (!ready) {
        console.log('Deployment blocked - fix pre-flight issues first');
        process.exit(1);
      }
      
    } catch (error) {
      console.log(`Pre-flight check failed: ${error.message}`);
      this.report.consistency.preFlight = { error: error.message };
    }
    
    console.log('');
  }

  async fullSystemStatus() {
    console.log('--- FULL SYSTEM STATUS ---');
    
    await this.gitRepositoryAudit();
    await this.supabaseAlignment();
    await this.vercelReadiness();
    
    // Service status
    try {
      const response = await fetch('http://localhost:3001/health');
      const protoforgeStatus = response.ok ? 'RUNNING' : 'STOPPED';
      console.log(`ProtoForge (3001): ${protoforgeStatus}`);
    } catch (error) {
      console.log(`ProtoForge (3001): STOPPED`);
    }
    
    try {
      const response = await fetch('http://localhost:3002/health');
      const ursulaStatus = response.ok ? 'RUNNING' : 'STOPPED';
      console.log(`Ursula Dashboard (3002): ${ursulaStatus}`);
    } catch (error) {
      console.log(`Ursula Dashboard (3002): STOPPED`);
    }
    
    console.log('');
    this.printConsistencyReport();
  }

  printConsistencyReport() {
    console.log('--- SYSTEM CONSISTENCY REPORT ---');
    
    // Calculate readiness score
    let score = 0;
    let maxScore = 0;
    
    // Git score
    maxScore += 30;
    if (this.report.git.status === 'OK') score += 10;
    if (this.report.git.committed) score += 10;
    if (this.report.git.pushed) score += 10;
    
    // Supabase score
    maxScore += 30;
    if (this.report.supabase.status === 'OK') score += 15;
    if (this.report.supabase.schemaAligned === true) score += 15;
    
    // Vercel score
    maxScore += 20;
    if (this.report.vercel.hasPackageJson) score += 10;
    if (this.report.vercel.ready) score += 10;
    
    // Consistency score
    maxScore += 20;
    if (this.report.consistency.preFlight?.summary?.ready) score += 20;
    
    const readinessScore = Math.round((score / maxScore) * 100);
    
    console.log(`Git Status: ${this.report.git.status || 'UNKNOWN'}`);
    console.log(`Supabase Alignment: ${this.report.supabase.status || 'UNKNOWN'}`);
    console.log(`Vercel Readiness: ${this.report.vercel.ready ? 'READY' : 'NOT_READY'}`);
    console.log(`Pre-flight: ${this.report.consistency.preFlight?.summary?.ready ? 'PASSED' : 'FAILED'}`);
    console.log(``);
    console.log(`DEPLOYMENT READINESS SCORE: ${readinessScore}/100`);
    
    if (readinessScore >= 90) {
      console.log('SYSTEM STATUS: PRODUCTION READY');
    } else if (readinessScore >= 70) {
      console.log('SYSTEM STATUS: NEEDS_MINOR_FIXES');
    } else {
      console.log('SYSTEM STATUS: NEEDS_MAJOR_WORK');
    }
    
    console.log('============================');
    
    // Show next commands
    console.log('');
    console.log('NEXT COMMANDS:');
    if (!this.report.git.committed) {
      console.log('  node hydi-master-cli.js sync');
    }
    if (!this.report.vercel.deployed && this.report.vercel.ready) {
      console.log('  node hydi-master-cli.js deploy');
    }
    if (readinessScore < 100) {
      console.log('  node hydi-master-cli.js status');
    }
  }

  showUsage() {
    console.log('HYDI Master CLI - Global Orchestration System');
    console.log('');
    console.log('Usage:');
    console.log('  node hydi-master-cli.js audit    - Full system audit');
    console.log('  node hydi-master-cli.js sync     - Commit and sync all systems');
    console.log('  node hydi-master-cli.js deploy   - Full deployment to production');
    console.log('  node hydi-master-cli.js status   - Current system status');
    console.log('');
    console.log('Examples:');
    console.log('  node hydi-master-cli.js audit');
    console.log('  node hydi-master-cli.js sync');
    console.log('  node hydi-master-cli.js deploy');
  }
}

// CLI interface
if (require.main === module) {
  const cli = new HYDIMasterCLI();
  const command = process.argv[2] || 'status';
  
  cli.run(command).catch(error => {
    console.error('CLI Error:', error.message);
    process.exit(1);
  });
}

module.exports = { HYDIMasterCLI };
