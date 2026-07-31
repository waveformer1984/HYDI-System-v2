'use strict';

const fs = require('fs').promises;
const path = require('path');

const CHUNK_SIZE = 1024;
const CHUNK_OVERLAP = 128;

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const chunks = [];
  let i = 0;
  while (i < normalized.length) {
    const end = Math.min(i + size, normalized.length);
    chunks.push(normalized.slice(i, end));
    if (end === normalized.length) break;
    i = end - overlap;
    if (i >= normalized.length) break;
  }
  return chunks;
}

class KnowledgePipeline {
  constructor(config = {}) {
    this.embeddingManager = config.embeddingManager || null;
    this.modelRouter = config.modelRouter || null;
    this.logger = config.logger || console;
    this.supportedExtensions = new Set(config.extensions || ['.md', '.txt', '.json', '.js', '.ts', '.yml', '.yaml', '.toml', '.ini', '.cfg']);
  }

  async ingestDirectory(dir, opts = {}) {
    const recursive = opts.recursive !== false;
    const files = await this._walk(dir, recursive);
    const results = { indexed: 0, errors: 0, files: 0 };
    for (const file of files) {
      try {
        const added = await this.ingestFile(file, dir);
        results.indexed += added;
        results.files++;
      } catch (e) {
        this.logger.error('[KnowledgePipeline] ingest error', { file, error: e instanceof Error ? e.message : String(e) });
        results.errors++;
      }
    }
    return results;
  }

  async ingestFile(filePath, rootDir = '') {
    if (!this.supportedExtensions.has(path.extname(filePath).toLowerCase())) return 0;
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) return 0;
    const chunks = chunkText(content);
    let added = 0;
    for (const chunk of chunks) {
      const ok = await this.embeddingManager.addDocument(chunk, {
        source: 'knowledge',
        file: filePath,
        relative: rootDir ? path.relative(rootDir, filePath) : filePath,
        at: Date.now(),
      });
      if (ok) added++;
    }
    return added;
  }

  async query(question, limit = 5) {
    if (!this.embeddingManager) return [];
    return this.embeddingManager.search(question, limit);
  }

  async summarizeTopic(topic) {
    const docs = await this.query(topic, 8);
    if (!docs.length) return { text: 'No relevant documents found.', sources: [] };
    const context = docs.map((d, i) => `--- Source ${i + 1} (${d.meta?.relative || d.meta?.file || 'unknown'}) ---\n${d.text}`).join('\n\n');
    const prompt = `Topic: ${topic}\n\n${context}\n\nProvide a concise executive summary. Cite the sources implicitly by referring to them as [source N].`;
    if (!this.modelRouter) return { text: context.slice(0, 2000), sources: docs.map((d) => d.meta?.relative || d.meta?.file) };
    const result = await this.modelRouter.summarize(prompt);
    return { text: result.text, sources: docs.map((d) => d.meta?.relative || d.meta?.file), usedModel: result.usedModel };
  }

  async _walk(dir, recursive) {
    let files = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'data') {
        files = files.concat(await this._walk(full, recursive));
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
    return files;
  }
}

module.exports = KnowledgePipeline;
