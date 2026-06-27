#!/usr/bin/env node

/**
 * ASSET ACCUMULATION LOOP
 * 
 * From files -> assets -> value tracking
 * One real external hook (zip export)
 * Heidi with execution time constraints
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ASSET REGISTRY (INVENTORY TRACKING)
class AssetRegistry {
  constructor() {
    this.assets = new Map(); // assetId -> asset
    this.assetCounter = 0;
  }

  registerAsset(type, location, fileCount, valueEstimate) {
    const asset = {
      id: `asset_${++this.assetCounter}`,
      type: type,
      location: location,
      fileCount: fileCount,
      createdAt: Date.now(),
      valueEstimate: valueEstimate,
      realRevenue: 0,
      status: 'created'
    };

    this.assets.set(asset.id, asset);
    console.log(`[ASSET] Registered: ${asset.id} (${type}) - Value: $${valueEstimate}`);

    return asset;
  }

  getAssets() {
    return Array.from(this.assets.values());
  }

  getTotalValue() {
    return Array.from(this.assets.values())
      .reduce((sum, asset) => sum + asset.valueEstimate, 0);
  }

  getRealRevenue() {
    return Array.from(this.assets.values())
      .reduce((sum, asset) => sum + asset.realRevenue, 0);
  }
}

// REAL EXTERNAL HOOK (ZIP EXPORT)
class ExternalHooks {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = ['./ready_to_sell', './exports'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  // ONE REAL EXTERNAL HOOK: ZIP EXPORT
  async exportToZip(assetId, sourcePath) {
    console.log(`[EXTERNAL] Exporting asset ${assetId} to ZIP...`);

    try {
      const zipPath = `./ready_to_sell/${assetId}.zip`;

      // Create zip file (real external operation)
      execSync(`cd "${sourcePath}" && zip -r "../../${zipPath}" .`, { stdio: 'pipe' });

      // Verify zip was created
      const zipExists = fs.existsSync(zipPath);
      const zipSize = zipExists ? fs.statSync(zipPath).size : 0;

      console.log(`[EXTERNAL] ZIP created: ${zipPath} (${zipSize} bytes)`);

      return {
        exported: zipExists,
        zipPath: zipPath,
        size: zipSize,
        readyForHuman: true
      };

    } catch (error) {
      console.log(`[EXTERNAL] ZIP export failed: ${error.message}`);
      return {
        exported: false,
        error: error.message
      };
    }
  }
}

// CALM HEIDI (WITH TIME CONSTRAINTS)
class CalmHeidi {
  constructor() {
    this.taskCounter = 0;
    this.activeTasks = new Map();
    this.maxExecutionTime = 2 * 60 * 1000; // 2 minutes max
  }

  // Generate tasks with execution time constraints
  generateAssetTask(title, type, actions, proof, valueEstimate, estimatedTime) {
    // REJECT if execution time > 2 minutes
    if (estimatedTime > this.maxExecutionTime) {
      console.log(`[HEIDI] Task rejected: ${title} (execution time ${estimatedTime / 1000}s > 2min)`);
      return null;
    }

    const task = {
      id: `task_${++this.taskCounter}`,
      title: title,
      assetType: type,
      valueEstimate: valueEstimate,
      estimatedTime: estimatedTime,
      requiredActions: actions,
      completionProof: proof,
      deadline: Date.now() + (30 * 60 * 1000), // 30 minutes
      priority: 'medium',
      status: 'pending',
      createdAt: Date.now()
    };

    this.activeTasks.set(task.id, task);
    console.log(`[HEIDI] Generated asset task: ${task.title} (${type}, $${valueEstimate}, ${estimatedTime / 1000}s)`);

    return task;
  }

  // Asset-focused tasks (not action-focused)
  generateSamplePackAsset() {
    return this.generateAssetTask(
      'Create sample pack asset',
      'sample_pack',
      [
        'load sample list',
        'select 10 samples',
        'copy files to output folder',
        'create manifest',
        'generate pack metadata'
      ],
      [
        '10 files exist in ./output/sample_pack_001/',
        'manifest.json exists in ./output/sample_pack_001/'
      ],
      25, // $25 value estimate
      45000 // 45 seconds estimated
    );
  }

  generateTemplateAsset() {
    return this.generateAssetTask(
      'Create template asset',
      'template',
      [
        'create template structure',
        'add documentation',
        'create example files',
        'generate template metadata'
      ],
      [
        'template files exist in ./output/template_001/',
        'readme.md exists in ./output/template_001/'
      ],
      35, // $35 value estimate
      60000 // 60 seconds estimated
    );
  }

  generateContentAsset() {
    return this.generateAssetTask(
      'Create content asset',
      'content',
      [
        'create text content',
        'format content',
        'create metadata',
        'export to ready folder'
      ],
      [
        'content exists in ./output/content_001/',
        'exported to ./ready_to_sell/'
      ],
      15, // $15 value estimate
      30000 // 30 seconds estimated
    );
  }

  processExecutionResult(executionReport) {
    const task = this.activeTasks.get(executionReport.taskId);
    if (!task) return;

    if (executionReport.status === 'success') {
      console.log(`[HEIDI] Asset task succeeded: ${task.title}`);
      task.priority = 'high';
    } else {
      console.log(`[HEIDI] Asset task failed: ${task.title} - ${executionReport.blockers.join(', ')}`);
      task.priority = 'low';
    }
  }
}

// ENHANCED URSULA (ASSET-CREATOR)
class AssetCreatorUrsula {
  constructor(assetRegistry, externalHooks) {
    this.handlers = new RealActionHandlers();
    this.assetRegistry = assetRegistry;
    this.externalHooks = externalHooks;
    this.executionHistory = new Map();
  }

  async executeAssetTask(task) {
    console.log(`[URSULA] Creating asset: ${task.title}`);
    const startTime = Date.now();

    const executionReport = {
      taskId: task.id,
      status: 'in_progress',
      evidence: [],
      assetCreated: false,
      assetId: null,
      blockers: [],
      timestamp: startTime
    };

    try {
      // Execute actions with time tracking
      for (const action of task.requiredActions) {
        const actionStart = Date.now();

        // Check execution time constraint
        if (Date.now() - startTime > 120000) { // 2 minutes
          throw new Error('Task exceeded 2-minute execution limit');
        }

        const result = await this.handlers.handleAction(action);
        result.executionTime = Date.now() - actionStart;
        executionReport.evidence.push(result);
      }

      // Validate completion proof
      const proofValidation = this.validateRealProof(task.completionProof);

      if (proofValidation.valid) {
        // Register asset
        const assetLocation = this.extractAssetLocation(task.completionProof);
        const fileCount = this.countAssetFiles(assetLocation);

        const asset = this.assetRegistry.registerAsset(
          task.assetType,
          assetLocation,
          fileCount,
          task.valueEstimate
        );

        executionReport.assetCreated = true;
        executionReport.assetId = asset.id;
        executionReport.status = 'success';

        // External hook: export to ZIP
        if (task.assetType === 'sample_pack') {
          const exportResult = await this.externalHooks.exportToZip(asset.id, assetLocation);
          executionReport.exportResult = exportResult;
        }

        console.log(`[URSULA] Asset SUCCESS: ${task.title} - Asset ${asset.id} created`);
      } else {
        executionReport.status = 'failed';
        executionReport.blockers = proofValidation.missingProof;
        console.log(`[URSULA] Asset FAILED: ${task.title} - Missing proof: ${proofValidation.missingProof.join(', ')}`);
      }

    } catch (error) {
      executionReport.status = 'failed';
      executionReport.blockers.push(error.message);
      console.log(`[URSULA] Asset FAILED: ${task.title} - ${error.message}`);
    }

    executionReport.duration = Date.now() - startTime;
    this.executionHistory.set(task.id, executionReport);
    return executionReport;
  }

  validateRealProof(requiredProof) {
    const missingProof = [];

    for (const proof of requiredProof) {
      if (proof.includes('files exist in')) {
        const match = proof.match(/files exist in (.+)/);
        if (match) {
          const dir = match[1];
          const exists = fs.existsSync(dir);
          const files = exists ? fs.readdirSync(dir) : [];
          const fileCount = parseInt(proof.match(/(\d+) files/)?.[1] || '0');

          if (!exists || files.length < fileCount) {
            missingProof.push(proof);
          }
        }
      } else if (proof.includes('exists in')) {
        const match = proof.match(/(.+) exists in (.+)/);
        if (match) {
          const [, filename, dir] = match;
          const filePath = path.join(dir, filename);
          if (!fs.existsSync(filePath)) {
            missingProof.push(proof);
          }
        }
      }
    }

    return {
      valid: missingProof.length === 0,
      missingProof: missingProof
    };
  }

  extractAssetLocation(proof) {
    for (const p of proof) {
      const match = p.match(/files exist in (.+)/);
      if (match) {
        return match[1];
      }
    }
    return './output/unknown';
  }

  countAssetFiles(location) {
    if (!fs.existsSync(location)) return 0;
    return fs.readdirSync(location).length;
  }
}

// Reuse RealActionHandlers from previous version
class RealActionHandlers {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = ['./samples', './output', './temp'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Create fake samples
    if (fs.readdirSync('./samples').length === 0) {
      for (let i = 1; i <= 15; i++) {
        fs.writeFileSync(`./samples/sample_${i.toString().padStart(2, '0')}.wav`, `fake sample data ${i}`);
      }
    }
  }

  async handleAction(action) {
    console.log(`[URSULA] Executing: ${action}`);

    try {
      switch (action) {
        case 'load sample list':
          return this.loadSampleList();

        case 'select 10 samples':
          return this.selectSamples(10);

        case 'copy files to output folder':
          return this.copyFilesToOutput('sample_pack_001');

        case 'create manifest':
          return this.createManifest('sample_pack_001');

        case 'generate pack metadata':
          return this.generatePackMetadata('sample_pack_001');

        case 'create template structure':
          return this.createTemplateStructure();

        case 'add documentation':
          return this.addDocumentation();

        case 'create example files':
          return this.createExampleFiles();

        case 'generate template metadata':
          return this.generateTemplateMetadata();

        case 'create text content':
          return this.createTextContent();

        case 'format content':
          return this.formatContent();

        case 'create metadata':
          return this.createContentMetadata();

        case 'export to ready folder':
          return this.exportToReadyFolder();

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      console.log(`[URSULA] Action failed: ${error.message}`);
      throw error;
    }
  }

  loadSampleList() {
    const samples = fs.readdirSync('./samples');
    return {
      action: 'load sample list',
      result: samples,
      evidence: `Loaded ${samples.length} samples`,
      timestamp: Date.now()
    };
  }

  selectSamples(count) {
    const samples = fs.readdirSync('./samples');
    const selected = samples.slice(0, count);

    return {
      action: 'select 10 samples',
      result: selected,
      evidence: `Selected ${selected.length} samples`,
      timestamp: Date.now()
    };
  }

  copyFilesToOutput(packName) {
    const samples = fs.readdirSync('./samples').slice(0, 10);
    const outputDir = `./output/${packName}`;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let copied = 0;
    samples.forEach(sample => {
      const src = path.join('./samples', sample);
      const dst = path.join(outputDir, sample);
      fs.copyFileSync(src, dst);
      copied++;
    });

    return {
      action: 'copy files to output folder',
      result: copied,
      evidence: `Copied ${copied} files to ${outputDir}`,
      timestamp: Date.now()
    };
  }

  createManifest(packName) {
    const outputDir = `./output/${packName}`;
    const files = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : [];

    const manifest = {
      pack_name: packName,
      created: new Date().toISOString(),
      files: files,
      file_count: files.length
    };

    const manifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    return {
      action: 'create manifest',
      result: manifestPath,
      evidence: `Created manifest with ${files.length} files`,
      timestamp: Date.now()
    };
  }

  generatePackMetadata(packName) {
    const outputDir = `./output/${packName}`;
    const metadata = {
      pack_id: packName,
      type: 'sample_pack',
      created: new Date().toISOString(),
      value_estimate: 25,
      files: fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : []
    };

    const metadataPath = path.join(outputDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      action: 'generate pack metadata',
      result: metadataPath,
      evidence: `Generated metadata for ${packName}`,
      timestamp: Date.now()
    };
  }

  createTemplateStructure() {
    const templateDir = './output/template_001';
    if (!fs.existsSync(templateDir)) {
      fs.mkdirSync(templateDir, { recursive: true });
    }

    // Create basic template files
    fs.writeFileSync(path.join(templateDir, 'template.js'), '// Template file');
    fs.writeFileSync(path.join(templateDir, 'config.json'), '{"name": "template"}');

    return {
      action: 'create template structure',
      result: templateDir,
      evidence: `Created template structure in ${templateDir}`,
      timestamp: Date.now()
    };
  }

  addDocumentation() {
    const readmePath = './output/template_001/readme.md';
    const readme = `# Template Documentation\n\nThis is a template.\n\n## Usage\n\n1. Download\n2. Use\n`;
    fs.writeFileSync(readmePath, readme);

    return {
      action: 'add documentation',
      result: readmePath,
      evidence: `Created documentation: ${readmePath}`,
      timestamp: Date.now()
    };
  }

  createExampleFiles() {
    const templateDir = './output/template_001';
    fs.writeFileSync(path.join(templateDir, 'example.js'), '// Example usage');
    fs.writeFileSync(path.join(templateDir, 'example.config.json'), '{"example": true}');

    return {
      action: 'create example files',
      result: 2,
      evidence: `Created 2 example files`,
      timestamp: Date.now()
    };
  }

  generateTemplateMetadata() {
    const metadata = {
      template_id: 'template_001',
      type: 'template',
      created: new Date().toISOString(),
      value_estimate: 35,
      files: fs.readdirSync('./output/template_001')
    };

    const metadataPath = './output/template_001/metadata.json';
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      action: 'generate template metadata',
      result: metadataPath,
      evidence: `Generated template metadata`,
      timestamp: Date.now()
    };
  }

  createTextContent() {
    const contentDir = './output/content_001';
    if (!fs.existsSync(contentDir)) {
      fs.mkdirSync(contentDir, { recursive: true });
    }

    const content = `# Generated Content\n\nThis is valuable content.\n\nCreated: ${new Date().toISOString()}`;
    fs.writeFileSync(path.join(contentDir, 'content.md'), content);

    return {
      action: 'create text content',
      result: contentDir,
      evidence: `Created content in ${contentDir}`,
      timestamp: Date.now()
    };
  }

  formatContent() {
    // Content is already formatted in createTextContent
    return {
      action: 'format content',
      result: 'formatted',
      evidence: `Content formatted`,
      timestamp: Date.now()
    };
  }

  createContentMetadata() {
    const metadata = {
      content_id: 'content_001',
      type: 'content',
      created: new Date().toISOString(),
      value_estimate: 15,
      files: fs.readdirSync('./output/content_001')
    };

    const metadataPath = './output/content_001/metadata.json';
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      action: 'create content metadata',
      result: metadataPath,
      evidence: `Created content metadata`,
      timestamp: Date.now()
    };
  }

  exportToReadyFolder() {
    const contentDir = './output/content_001';
    const readyDir = './ready_to_sell';

    // Copy content to ready folder
    const files = fs.readdirSync(contentDir);
    files.forEach(file => {
      const src = path.join(contentDir, file);
      const dst = path.join(readyDir, `content_001_${file}`);
      fs.copyFileSync(src, dst);
    });

    return {
      action: 'export to ready folder',
      result: files.length,
      evidence: `Exported ${files.length} files to ready folder`,
      timestamp: Date.now()
    };
  }
}

// ASSET ACCUMULATION LOOP
class AssetAccumulationLoop {
  constructor() {
    this.assetRegistry = new AssetRegistry();
    this.externalHooks = new ExternalHooks();
    this.heidi = new CalmHeidi();
    this.ursula = new AssetCreatorUrsula(this.assetRegistry, this.externalHooks);
    this.metrics = {
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      assetsCreated: 0,
      totalValue: 0,
      realRevenue: 0
    };
  }

  async runAssetLoop() {
    console.log('=== ASSET ACCUMULATION LOOP ===\n');

    // Clean up previous runs
    if (fs.existsSync('./output')) {
      fs.rmSync('./output', { recursive: true });
    }

    // Step 1: Generate asset tasks
    console.log('Step 1: Generating asset tasks...\n');
    const tasks = [
      this.heidi.generateSamplePackAsset(),
      this.heidi.generateTemplateAsset(),
      this.heidi.generateContentAsset()
    ].filter(task => task !== null);

    this.metrics.totalTasks = tasks.length;
    console.log(`Generated ${tasks.length} asset tasks\n`);

    // Step 2: Execute asset creation
    console.log('Step 2: Creating assets...\n');
    const executionResults = [];

    for (const task of tasks) {
      try {
        const result = await this.ursula.executeAssetTask(task);
        executionResults.push(result);

        if (result.status === 'success') {
          this.metrics.successfulTasks++;
          this.metrics.assetsCreated++;
          this.metrics.totalValue += task.valueEstimate;
        } else {
          this.metrics.failedTasks++;
        }

        this.heidi.processExecutionResult(result);

      } catch (error) {
        console.log(`[LOOP] Execution error: ${error.message}`);
        this.metrics.failedTasks++;
      }
    }

    // Step 3: Show asset results
    console.log('\nStep 3: Asset Accumulation Review\n');
    this.reviewAssets(executionResults);

    // Step 4: Show final metrics
    console.log('\n=== ASSET LOOP METRICS ===\n');
    this.showMetrics();
  }

  reviewAssets(executionResults) {
    for (const result of executionResults) {
      console.log(`Task ${result.taskId}: ${result.status.toUpperCase()}`);

      if (result.status === 'success') {
        console.log(`  Asset created: ${result.assetId}`);
        console.log(`  Value estimate: $${this.assetRegistry.assets.get(result.assetId)?.valueEstimate}`);
        console.log(`  Execution time: ${(result.duration / 1000).toFixed(1)}s`);

        if (result.exportResult) {
          console.log(`  Exported: ${result.exportResult.exported ? 'YES' : 'NO'}`);
          if (result.exportResult.exported) {
            console.log(`  ZIP size: ${result.exportResult.size} bytes`);
          }
        }
      } else {
        console.log(`  Blockers: ${result.blockers.join(', ')}`);
      }

      console.log();
    }
  }

  showMetrics() {
    console.log('Asset Loop Performance:');
    console.log(`  Total tasks: ${this.metrics.totalTasks}`);
    console.log(`  Successful: ${this.metrics.successfulTasks}`);
    console.log(`  Failed: ${this.metrics.failedTasks}`);
    console.log(`  Success rate: ${(this.metrics.successfulTasks / this.metrics.totalTasks * 100).toFixed(1)}%`);
    console.log();

    console.log('Asset Accumulation:');
    console.log(`  Assets created: ${this.metrics.assetsCreated}`);
    console.log(`  Total value estimate: $${this.metrics.totalValue}`);
    console.log(`  Real revenue: $${this.metrics.realRevenue}`);
    console.log();

    console.log('Asset Registry:');
    const assets = this.assetRegistry.getAssets();
    assets.forEach(asset => {
      console.log(`  ${asset.id}: ${asset.type} - $${asset.valueEstimate} - ${asset.fileCount} files`);
    });
    console.log();

    console.log('External Integration:');
    const readyFiles = fs.existsSync('./ready_to_sell') ? fs.readdirSync('./ready_to_sell') : [];
    console.log(`  Files in ./ready_to_sell/: ${readyFiles.length}`);
    if (readyFiles.length > 0) {
      console.log(`  Files: ${readyFiles.join(', ')}`);
    }
  }
}

// DEMONSTRATION
async function demonstrateAssetLoop() {
  const loop = new AssetAccumulationLoop();
  await loop.runAssetLoop();
}

// Run demonstration
if (require.main === module) {
  demonstrateAssetLoop().catch(console.error);
}

module.exports = { AssetAccumulationLoop, AssetRegistry, CalmHeidi, AssetCreatorUrsula };
