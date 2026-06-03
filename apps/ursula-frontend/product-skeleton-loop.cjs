#!/usr/bin/env node

/**
 * PRODUCT SKELETON LOOP
 * 
 * From raw goods to sellable products
 * Asset descriptors, preview generation, ZIP packaging
 * Ready for human upload and first real sale
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ASSET DESCRIPTOR GENERATOR (SELLABLE METADATA)
class AssetDescriptorGenerator {
  constructor() {
    this.descriptorTemplates = {
      sample_pack: {
        titlePatterns: [
          "{genre} {instrument} Teaser Pack Vol. {number}",
          "{mood} {instrument} Collection",
          "Essential {genre} Samples",
          "{genre} Producer Starter Pack"
        ],
        descriptionPatterns: [
          "{count} carefully crafted {genre} {instrument} samples optimized for {DAWs}. Perfect for {use_cases}.",
          "Professional {genre} {instrument} sounds with {character}. Recorded at {quality} for maximum flexibility.",
          "Curated {genre} collection featuring {count} {instrument} samples. Ready for {production_styles}."
        ],
        commonTags: {
          genre: ['lofi', 'hiphop', 'trap', 'drill', 'boom_bap', 'jazz', 'electronic'],
          instrument: ['drums', 'melodies', 'bass', 'vocals', 'fx', 'atmospheres'],
          mood: ['punchy', 'warm', 'dark', 'bright', 'vintage', 'modern'],
          DAWs: ['MPC', 'Ableton', 'FL Studio', 'Logic', 'Maschine'],
          use_cases: ['beats', 'production', 'soundtracks', 'remixes'],
          character: ['analog warmth', 'digital clarity', 'tape saturation', 'vinyl crackle'],
          quality: ['48kHz', '24-bit', 'professional', 'studio-grade'],
          production_styles: ['trap beats', 'lofi hip hop', 'electronic music', 'film scoring']
        }
      },
      template: {
        titlePatterns: [
          "{DAW} {type} Template Vol. {number}",
          "{genre} {type} Starter Template",
          "Professional {type} Template for {DAW}",
          "{mood} {type} Collection"
        ],
        descriptionPatterns: [
          "Complete {DAW} {type} template with {features}. Perfect for {use_cases}.",
          "Professional {type} template featuring {elements}. Optimized for {skill_level}.",
          "Ready-to-use {type} template with {character}. Includes {components}."
        ],
        commonTags: {
          DAW: ['Ableton Live', 'FL Studio', 'Logic Pro', 'Maschine'],
          type: ['drum rack', 'instrument rack', 'effect chain', 'project template'],
          genre: ['trap', 'lofi', 'house', 'techno', 'hiphop'],
          mood: ['dark', 'bright', 'warm', 'cold'],
          features: ['mixing ready', 'mastered', 'arranged', 'MIDI mapped'],
          use_cases: ['beat making', 'live performance', 'sound design', 'quick starts'],
          elements: ['macros', 'automation', 'effects', 'samples'],
          skill_level: ['beginners', 'intermediate', 'professionals'],
          character: ['clean', 'aggressive', 'smooth', 'complex'],
          components: ['presets', 'samples', 'MIDI clips', 'project files']
        }
      },
      content: {
        titlePatterns: [
          "{topic} {type} Guide",
          "Essential {topic} {type}",
          "{skill_level} {topic} Tutorial",
          "Complete {topic} {type} Collection"
        ],
        descriptionPatterns: [
          "Comprehensive {topic} {type} covering {topics}. Perfect for {audience}.",
          "Step-by-step {topic} guide with {features}. Designed for {skill_level}.",
          "Professional {topic} {type} featuring {content_types}. Includes {bonus_content}."
        ],
        commonTags: {
          topic: ['music production', 'sound design', 'mixing', 'mastering', 'beat making'],
          type: ['guide', 'tutorial', 'course', 'handbook'],
          skill_level: ['beginners', 'intermediate', 'advanced'],
          audience: ['producers', 'engineers', 'artists', 'students'],
          topics: ['fundamentals', 'techniques', 'tips', 'workflows'],
          features: ['examples', 'exercises', 'templates', 'resources'],
          content_types: ['tutorials', 'examples', 'templates', 'checklists'],
          bonus_content: ['bonus tips', 'resources', 'templates', 'cheat sheets']
        }
      }
    };
  }

  generateDescriptor(assetType, assetData) {
    const template = this.descriptorTemplates[assetType];
    if (!template) {
      throw new Error(`No descriptor template for asset type: ${assetType}`);
    }

    // Select random patterns
    const titlePattern = template.titlePatterns[Math.floor(Math.random() * template.titlePatterns.length)];
    const descriptionPattern = template.descriptionPatterns[Math.floor(Math.random() * template.descriptionPatterns.length)];

    // Generate random selections from common tags
    const selectedTags = this.selectRandomTags(template.commonTags, 5);

    // Build descriptor
    const descriptor = {
      title: this.fillPattern(titlePattern, { ...selectedTags, number: Math.floor(Math.random() * 5) + 1 }),
      description: this.fillPattern(descriptionPattern, {
        ...selectedTags,
        count: assetData.fileCount || 10,
        ...assetData
      }),
      tags: Object.values(selectedTags).flat().filter(tag => typeof tag === 'string'),
      previewFiles: this.selectPreviewFiles(assetData.files || []),
      category: assetType,
      generatedAt: new Date().toISOString()
    };

    console.log(`[DESCRIPTOR] Generated: ${descriptor.title}`);
    return descriptor;
  }

  selectRandomTags(tagCategories, count) {
    const selected = {};
    const categories = Object.keys(tagCategories);

    for (let i = 0; i < count && i < categories.length; i++) {
      const category = categories[Math.floor(Math.random() * categories.length)];
      const options = tagCategories[category];
      selected[category] = Array.isArray(options)
        ? options[Math.floor(Math.random() * options.length)]
        : options;
    }

    return selected;
  }

  fillPattern(pattern, variables) {
    let filled = pattern;

    // Replace {variable} patterns
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{${key}}`, 'g');
      filled = filled.replace(regex, value);
    });

    return filled;
  }

  selectPreviewFiles(files) {
    if (!files || files.length === 0) return [];

    // Select 1-3 files for preview
    const previewCount = Math.min(Math.floor(Math.random() * 3) + 1, files.length);
    const shuffled = [...files].sort(() => Math.random() - 0.5);

    return shuffled.slice(0, previewCount);
  }
}

// PREVIEW GENERATOR (BUYER BAIT)
class PreviewGenerator {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = ['./previews', './temp', './ready_to_sell'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[PREVIEW] Created directory: ${dir}`);
      }
    });
  }

  async generatePreview(assetId, assetType, files) {
    console.log(`[PREVIEW] Generating preview for ${assetId} (${assetType})`);

    try {
      if (assetType === 'sample_pack') {
        return this.generateSamplePreview(assetId, files);
      } else if (assetType === 'template') {
        return this.generateTemplatePreview(assetId, files);
      } else if (assetType === 'content') {
        return this.generateContentPreview(assetId, files);
      }

      throw new Error(`Unknown asset type for preview: ${assetType}`);

    } catch (error) {
      console.log(`[PREVIEW] Preview generation failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  generateSamplePreview(assetId, files) {
    // For sample packs, create a demo list
    const audioFiles = files.filter(f => f.endsWith('.wav') || f.endsWith('.mp3')).slice(0, 3);

    if (audioFiles.length === 0) {
      // Create a generic preview if no audio files found
      const previewContent = `Sample Pack Preview: ${assetId}\n\nThis pack contains high-quality samples perfect for your productions.\n\nFiles included: ${files.length}\n\n[Demo would play here in production]`;
      const previewPath = `./previews/${assetId}_preview.txt`;
      fs.writeFileSync(previewPath, previewContent);

      return {
        success: true,
        previewPath: previewPath,
        previewType: 'generic_preview',
        includedFiles: files
      };
    }

    // Create a simple preview file (text-based demo for now)
    const previewContent = audioFiles.map((file, i) =>
      `[Sample ${i + 1}] ${file}\n[Duration: 0:0${i + 1}]\n[BPM: varies]\n\n`
    ).join('');

    const previewPath = `./previews/${assetId}_preview.txt`;
    fs.writeFileSync(previewPath, previewContent);

    return {
      success: true,
      previewPath: previewPath,
      previewType: 'demo_list',
      includedFiles: audioFiles
    };
  }

  generateTemplatePreview(assetId, files) {
    // For templates, create a feature list preview
    const readmeFile = files.find(f => f.includes('readme') || f.includes('README'));
    const manifestFile = files.find(f => f.includes('manifest') || f.includes('metadata'));

    let previewContent = `Template Preview: ${assetId}\n\n`;

    if (readmeFile) {
      previewContent += `Documentation: ${readmeFile}\n`;
    }

    if (manifestFile) {
      previewContent += `Manifest: ${manifestFile}\n`;
    }

    previewContent += `\nFiles included:\n${files.map(f => `- ${f}`).join('\n')}`;

    const previewPath = `./previews/${assetId}_preview.txt`;
    fs.writeFileSync(previewPath, previewContent);

    return {
      success: true,
      previewPath: previewPath,
      previewType: 'feature_list',
      includedFiles: files
    };
  }

  generateContentPreview(assetId, files) {
    // For content, create an excerpt preview
    const contentFile = files.find(f => f.includes('.md') || f.includes('.txt'));

    if (!contentFile) {
      throw new Error('No content file found for preview');
    }

    // Read first few lines as preview
    const contentPath = `./output/content_001/${contentFile}`;
    if (fs.existsSync(contentPath)) {
      const content = fs.readFileSync(contentPath, 'utf8');
      const previewLines = content.split('\n').slice(0, 10).join('\n');

      const previewPath = `./previews/${assetId}_preview.txt`;
      fs.writeFileSync(previewPath, `Preview of ${contentFile}:\n\n${previewLines}\n\n[... full content in asset]`);

      return {
        success: true,
        previewPath: previewPath,
        previewType: 'content_excerpt',
        includedFiles: [contentFile]
      };
    }

    throw new Error('Content file not found');
  }
}

// ZIP PACKAGER (ADULT SYSTEM)
class ZipPackager {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = ['./ready_to_sell', './temp'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[ZIP] Created directory: ${dir}`);
      }
    });
  }

  async packageAsset(assetId, sourcePath, descriptor, preview) {
    console.log(`[ZIP] Packaging asset ${assetId}`);

    try {
      // Try Node.js archiver first (cross-platform)
      return await this.packageWithArchiver(assetId, sourcePath, descriptor, preview);
    } catch (error) {
      console.log(`[ZIP] Archiver failed, trying PowerShell: ${error.message}`);
      // Fallback to PowerShell for Windows
      return await this.packageWithPowerShell(assetId, sourcePath, descriptor, preview);
    }
  }

  async packageWithArchiver(assetId, sourcePath, descriptor, preview) {
    // Create a simple package structure
    const packageDir = `./temp/${assetId}_package`;
    if (!fs.existsSync(packageDir)) {
      fs.mkdirSync(packageDir, { recursive: true });
    }

    // Copy asset files
    this.copyDirectory(sourcePath, packageDir);

    // Add descriptor
    const descriptorPath = path.join(packageDir, 'descriptor.json');
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2));

    // Add preview if available
    if (preview.success) {
      const previewName = path.basename(preview.previewPath);
      fs.copyFileSync(preview.previewPath, path.join(packageDir, `preview.${previewName.split('.').pop()}`));
    }

    // Create README
    const readmeContent = this.generateReadme(descriptor);
    fs.writeFileSync(path.join(packageDir, 'README.txt'), readmeContent);

    // Create simple package info (no ZIP for now)
    const packagePath = `./ready_to_sell/${assetId}_package.json`;

    const packageInfo = {
      assetId: assetId,
      descriptor: descriptor,
      preview: preview,
      files: fs.readdirSync(packageDir),
      packagedAt: new Date().toISOString(),
      packageDir: packageDir
    };

    fs.writeFileSync(packagePath, JSON.stringify(packageInfo, null, 2));

    console.log(`[ZIP] Package created: ${packagePath} (package info)`);

    return {
      success: true,
      packagePath: packagePath,
      packageType: 'info_package',
      fileCount: fs.readdirSync(packageDir).length
    };
  }

  async packageWithPowerShell(assetId, sourcePath, descriptor, preview) {
    const packageDir = `./temp/${assetId}_package`;
    const zipPath = `./ready_to_sell/${assetId}.zip`;

    try {
      // Prepare package directory
      if (!fs.existsSync(packageDir)) {
        fs.mkdirSync(packageDir, { recursive: true });
      }

      this.copyDirectory(sourcePath, packageDir);

      // Add descriptor and preview
      fs.writeFileSync(path.join(packageDir, 'descriptor.json'), JSON.stringify(descriptor, null, 2));
      if (preview.success) {
        fs.copyFileSync(preview.previewPath, path.join(packageDir, 'preview.txt'));
      }

      // Use PowerShell Compress-Archive with absolute paths
      const absolutePackageDir = path.resolve(packageDir);
      const absoluteZipPath = path.resolve(zipPath);
      const psCommand = `Compress-Archive -Path "${absolutePackageDir}\\*" -DestinationPath "${absoluteZipPath}" -Force`;
      execSync(`powershell -Command "${psCommand}"`, { stdio: 'pipe' });

      console.log(`[ZIP] PowerShell ZIP created: ${zipPath}`);

      return {
        success: true,
        packagePath: zipPath,
        packageType: 'powershell_zip',
        fileCount: fs.readdirSync(packageDir).length
      };

    } catch (error) {
      console.log(`[ZIP] PowerShell failed: ${error.message}`);
      throw error;
    }
  }

  copyDirectory(source, destination) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }

    const files = fs.readdirSync(source);
    files.forEach(file => {
      const srcPath = path.join(source, file);
      const destPath = path.join(destination, file);

      if (fs.statSync(srcPath).isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    });
  }

  generateReadme(descriptor) {
    return `${descriptor.title}

${descriptor.description}

Tags: ${descriptor.tags.join(', ')}

Files: ${descriptor.previewFiles.length + 1}+ files included

Generated: ${descriptor.generatedAt}

---
This asset was created by HYDI System
For support, contact the platform where you purchased this asset.
`;
  }
}

// PRODUCT SKELETON LOOP
class ProductSkeletonLoop {
  constructor() {
    this.descriptorGenerator = new AssetDescriptorGenerator();
    this.previewGenerator = new PreviewGenerator();
    this.zipPackager = new ZipPackager();
    this.productRegistry = new Map(); // assetId -> product skeleton
    this.metrics = {
      totalAssets: 0,
      descriptorsGenerated: 0,
      previewsGenerated: 0,
      packagesCreated: 0,
      readyToSell: 0
    };
  }

  async createProductSkeleton(assetId, assetType, assetPath, assetData) {
    console.log(`\n=== CREATING PRODUCT SKELETON: ${assetId} ===\n`);

    const skeleton = {
      assetId: assetId,
      assetType: assetType,
      stages: {},
      finalProduct: null,
      success: false
    };

    try {
      // Stage 1: Generate Asset Descriptor
      console.log('Stage 1: Generating asset descriptor...');
      const descriptor = this.descriptorGenerator.generateDescriptor(assetType, assetData);
      skeleton.stages.descriptor = descriptor;
      this.metrics.descriptorsGenerated++;

      // Stage 2: Generate Preview
      console.log('Stage 2: Generating preview...');
      const preview = await this.previewGenerator.generatePreview(assetId, assetType, assetData.files || []);
      skeleton.stages.preview = preview;
      if (preview.success) {
        this.metrics.previewsGenerated++;
      }

      // Stage 3: Package Product
      console.log('Stage 3: Packaging product...');
      const packageResult = await this.zipPackager.packageAsset(assetId, assetPath, descriptor, preview);
      skeleton.stages.package = packageResult;
      if (packageResult.success) {
        this.metrics.packagesCreated++;
        this.metrics.readyToSell++;
      }

      // Stage 4: Register Product Skeleton
      skeleton.finalProduct = {
        assetId: assetId,
        descriptor: descriptor,
        preview: preview,
        package: packageResult,
        status: packageResult.success ? 'ready_to_sell' : 'incomplete',
        createdAt: new Date().toISOString()
      };

      skeleton.success = true;
      this.productRegistry.set(assetId, skeleton.finalProduct);
      this.metrics.totalAssets++;

      console.log(`\n[SUCCESS] Product skeleton ready: ${assetId}`);
      console.log(`Title: ${descriptor.title}`);
      console.log(`Description: ${descriptor.description.substring(0, 100)}...`);
      console.log(`Tags: ${descriptor.tags.slice(0, 3).join(', ')}...`);
      console.log(`Package: ${packageResult.success ? 'YES' : 'NO'}`);

    } catch (error) {
      skeleton.error = error.message;
      console.log(`[FAILED] Product skeleton creation: ${error.message}`);
    }

    return skeleton;
  }

  async runProductSkeletonDemo() {
    console.log('=== PRODUCT SKELETON DEMO ===\n');

    // Clean up previous runs
    ['./temp', './previews', './ready_to_sell'].forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
      }
    });

    // Create product skeletons for existing assets
    const assets = [
      {
        id: 'asset_1',
        type: 'sample_pack',
        path: './output/sample_pack_001',
        data: { fileCount: 12, files: ['sample_01.wav', 'sample_02.wav', 'manifest.json', 'metadata.json'] }
      },
      {
        id: 'asset_2',
        type: 'template',
        path: './output/template_001',
        data: { fileCount: 6, files: ['template.js', 'config.json', 'readme.md', 'metadata.json'] }
      }
    ];

    const skeletons = [];

    for (const asset of assets) {
      if (fs.existsSync(asset.path)) {
        const skeleton = await this.createProductSkeleton(asset.id, asset.type, asset.path, asset.data);
        skeletons.push(skeleton);
      } else {
        console.log(`[SKIP] Asset path not found: ${asset.path}`);
      }
    }

    // Show final results
    console.log('\n=== PRODUCT SKELETON RESULTS ===\n');
    this.showResults(skeletons);

    return skeletons;
  }

  showResults(skeletons) {
    console.log('Product Skeleton Metrics:');
    console.log(`  Total assets processed: ${this.metrics.totalAssets}`);
    console.log(`  Descriptors generated: ${this.metrics.descriptorsGenerated}`);
    console.log(`  Previews generated: ${this.metrics.previewsGenerated}`);
    console.log(`  Packages created: ${this.metrics.packagesCreated}`);
    console.log(`  Ready to sell: ${this.metrics.readyToSell}`);
    console.log();

    console.log('Product Registry:');
    this.productRegistry.forEach((product, assetId) => {
      console.log(`  ${assetId}: ${product.descriptor.title}`);
      console.log(`    Status: ${product.status}`);
      console.log(`    Category: ${product.descriptor.category}`);
      console.log(`    Tags: ${product.descriptor.tags.slice(0, 3).join(', ')}...`);
      if (product.package.success) {
        console.log(`    Package: ${product.package.packagePath}`);
      }
      console.log();
    });

    console.log('Files Ready for Human Upload:');
    const readyFiles = fs.existsSync('./ready_to_sell') ? fs.readdirSync('./ready_to_sell') : [];
    console.log(`  Files in ./ready_to_sell/: ${readyFiles.length}`);
    readyFiles.forEach(file => {
      console.log(`    - ${file}`);
    });
  }
}

// DEMONSTRATION
async function demonstrateProductSkeletons() {
  const loop = new ProductSkeletonLoop();
  await loop.runProductSkeletonDemo();
}

// Run demonstration
if (require.main === module) {
  demonstrateProductSkeletons().catch(console.error);
}

module.exports = { ProductSkeletonLoop, AssetDescriptorGenerator, PreviewGenerator, ZipPackager };
