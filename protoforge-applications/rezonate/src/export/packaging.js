const fs = require('fs');
const path = require('path');

function createFileOps(root = 'data/exports') {
  return {
    ensureDir: (dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    },
    writeFile: (file, data) => fs.writeFileSync(file, data),
    copyFile: (src, dest) => {
      if (!fs.existsSync(src)) throw new Error(`Source not found: ${src}`);
      fs.copyFileSync(src, dest);
    },
    path: {
      join: (...args) => path.join(...args),
      basename: (p) => path.basename(p)
    }
  };
}

function packageManifest({ project, projectId, assets = [], bpm, key }) {
  return {
    project,
    project_id: projectId,
    bpm,
    key,
    created: new Date().toISOString(),
    assets: assets.map(a => ({
      id: a.id,
      name: a.name || a.filename || 'untitled',
      type: a.type,
      file_path: a.file_path || a.filePath,
      bpm: a.bpm,
      key: a.key
    }))
  };
}

function packageStems({ projectId, projectName = 'untitled', assets = [], bpm, key, outputRoot = 'data/exports' } = {}, fileOps = createFileOps()) {
  if (!projectId) throw new Error('projectId is required');

  const outDir = fileOps.path.join(outputRoot, `${projectName}_${projectId.slice(0, 8)}`);
  fileOps.ensureDir(outDir);

  const manifest = packageManifest({ project: projectName, projectId, assets, bpm, key });
  fileOps.writeFile(fileOps.path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const packaged = [];
  for (const asset of assets) {
    const src = asset.file_path || asset.filePath;
    const name = asset.name || asset.filename || fileOps.path.basename(src) || `asset_${packaged.length + 1}.wav`;
    const dest = fileOps.path.join(outDir, name);
    fileOps.copyFile(src, dest);
    packaged.push({ name, dest });
  }

  return { manifest, outDir, packaged };
}

module.exports = { packageStems, packageManifest, createFileOps };
