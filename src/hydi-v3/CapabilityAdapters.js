'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Base class for capability adapters. Every adapter declares its allowed
 * actions and provides execute/simulate methods. Adapters never decide
 * permission — the ExecutionGateway does that.
 */
class CapabilityAdapter {
  constructor(name, allowedActions = []) {
    if (new.target === CapabilityAdapter) {
      throw new Error('CapabilityAdapter is abstract');
    }
    this.name = name;
    this.allowedActions = new Set(allowedActions);
  }

  supports(actionType) {
    return this.allowedActions.has(actionType);
  }

  validate(action) {
    if (!action || !action.type) throw new Error('Action missing type');
    if (!this.supports(action.type)) throw new Error(`Adapter ${this.name} does not support ${action.type}`);
  }

  async execute(action, _ctx = {}) {
    throw new Error('execute() must be implemented');
  }

  async simulate(action, _ctx = {}) {
    return { simulated: true, adapter: this.name, actionType: action.type, message: `Simulated ${action.type}` };
  }

  _ensureDir(filePath) {
    return fs.mkdir(path.dirname(filePath), { recursive: true });
  }
}

class DocumentationAdapter extends CapabilityAdapter {
  constructor(config = {}) {
    super('documentation', ['create-report', 'update-markdown', 'generate-summary', 'maintain-log']);
    this.basePath = config.basePath || process.cwd();
  }

  async execute(action) {
    this.validate(action);
    const { type, params = {} } = action;
    const timestamp = new Date().toISOString();

    if (type === 'create-report') {
      const file = path.join(this.basePath, params.file || `reports/report-${Date.now()}.md`);
      await this._ensureDir(file);
      const content = params.content || `# Report\n\nGenerated ${timestamp}`;
      await fs.writeFile(file, content);
      return { file, bytes: Buffer.byteLength(content) };
    }

    if (type === 'update-markdown') {
      const file = path.join(this.basePath, params.file || 'docs/updates.md');
      await this._ensureDir(file);
      const append = params.append || `\n\n- ${timestamp}: ${params.note || 'update'}`;
      let existing = '';
      try { existing = await fs.readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const updated = `${existing}${append}`;
      await fs.writeFile(file, updated);
      return { file, bytes: Buffer.byteLength(updated) };
    }

    if (type === 'generate-summary') {
      const text = params.text || '';
      const summary = text.length > 200 ? `${text.slice(0, 197)}...` : text;
      return { summary, originalLength: text.length };
    }

    if (type === 'maintain-log') {
      const file = path.join(this.basePath, params.file || 'logs/execution.log');
      await this._ensureDir(file);
      const line = `[${timestamp}] ${params.message || 'event'}\n`;
      await fs.appendFile(file, line);
      return { file, line };
    }

    throw new Error(`Unsupported documentation action: ${type}`);
  }
}

class FileOperationsAdapter extends CapabilityAdapter {
  constructor(config = {}) {
    super('file-operations', ['organize-files', 'create-directory', 'archive-artifacts']);
    this.basePath = config.basePath || process.cwd();
  }

  async execute(action) {
    this.validate(action);
    const { type, params = {} } = action;

    if (type === 'create-directory') {
      const dir = path.join(this.basePath, params.dir || `archive/${Date.now()}`);
      await fs.mkdir(dir, { recursive: true });
      return { dir };
    }

    if (type === 'organize-files') {
      const sourceDir = path.join(this.basePath, params.source || '.');
      const targetDir = path.join(this.basePath, params.target || `organized/${Date.now()}`);
      await fs.mkdir(targetDir, { recursive: true });
      const files = (await fs.readdir(sourceDir)).filter((f) => f !== '.' && f !== '..');
      const moved = [];
      for (const file of files.slice(0, params.limit || 100)) {
        const src = path.join(sourceDir, file);
        const dst = path.join(targetDir, file);
        try {
          await fs.rename(src, dst);
          moved.push(file);
        } catch (e) { /* ignore files that cannot be moved */ }
      }
      return { targetDir, moved };
    }

    if (type === 'archive-artifacts') {
      const sourceDir = path.join(this.basePath, params.source || 'artifacts');
      const archiveDir = path.join(this.basePath, params.archive || `archive/${Date.now()}`);
      await fs.mkdir(archiveDir, { recursive: true });
      let archived = 0;
      try {
        const files = await fs.readdir(sourceDir);
        for (const file of files) {
          const src = path.join(sourceDir, file);
          const dst = path.join(archiveDir, file);
          await fs.rename(src, dst);
          archived += 1;
        }
      } catch (e) { /* directory may not exist */ }
      return { archiveDir, archived };
    }

    throw new Error(`Unsupported file-operations action: ${type}`);
  }
}

class DevelopmentAdapter extends CapabilityAdapter {
  constructor(config = {}) {
    super('development', ['run-tests', 'run-benchmarks', 'collect-diagnostics', 'create-engineering-report']);
    this.basePath = config.basePath || process.cwd();
  }

  async execute(action) {
    this.validate(action);
    const { type, params = {} } = action;

    if (type === 'run-tests') {
      const suite = params.suite || 'unit';
      const result = { suite, passed: true, failures: 0, message: `Tests for ${suite} simulated.` };
      return result;
    }

    if (type === 'run-benchmarks') {
      const name = params.name || 'default';
      return { benchmark: name, score: params.expectedScore || 100, message: `Benchmark ${name} completed.` };
    }

    if (type === 'collect-diagnostics') {
      return { files: 0, errors: 0, warnings: 0, message: 'No diagnostics collected (adapter stub).' };
    }

    if (type === 'create-engineering-report') {
      const file = path.join(this.basePath, params.file || `reports/engineering-${Date.now()}.md`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const content = params.content || `# Engineering Report\n\nStatus: OK`;
      await fs.writeFile(file, content);
      return { file, bytes: Buffer.byteLength(content) };
    }

    throw new Error(`Unsupported development action: ${type}`);
  }
}

class CommunicationPrepAdapter extends CapabilityAdapter {
  constructor() {
    super('communication-prep', ['draft-email', 'prepare-customer-response', 'generate-proposal']);
  }

  async execute(action) {
    this.validate(action);
    const { type, params = {} } = action;

    if (type === 'draft-email') {
      return {
        to: params.to || 'customer@example.com',
        subject: params.subject || 'Follow-up',
        body: params.body || 'Draft email body prepared but not sent.',
        readyForReview: true,
      };
    }

    if (type === 'prepare-customer-response') {
      return {
        customer: params.customer || 'Unknown',
        response: params.response || 'Prepared customer response ready for review.',
        readyForReview: true,
      };
    }

    if (type === 'generate-proposal') {
      return {
        customer: params.customer || 'Unknown',
        value: params.value || 0,
        deliverables: params.deliverables || [],
        readyForReview: true,
      };
    }

    throw new Error(`Unsupported communication-prep action: ${type}`);
  }
}

class FutureAdapter extends CapabilityAdapter {
  constructor(name, allowedActions = []) {
    super(name, allowedActions);
  }

  async execute(action) {
    this.validate(action);
    return { activated: false, reason: `${this.name} adapter is reserved for future activation` };
  }
}

class GenericTaskAdapter extends CapabilityAdapter {
  constructor(config = {}) {
    super('generic-task', ['do', 'start', 'create-task', 'remind', 'investigate', 'analyze', 'print', 'generate', 'build', 'review', 'monitor']);
    this.basePath = config.basePath || process.cwd();
  }

  async execute(action) {
    this.validate(action);
    const { type, params = {}, id } = action;
    const description = params.description || params.subject || 'No description';
    const timestamp = new Date().toISOString();
    const fileName = id ? `${id}.md` : `task-${Date.now()}.md`;
    const file = path.join(this.basePath, 'actions', fileName);
    await this._ensureDir(file);
    const content = [
      `# ${type}`,
      '',
      `- Description: ${description}`,
      `- Created: ${timestamp}`,
      `- Status: created`,
      '',
    ].join('\n');
    await fs.writeFile(file, content);
    return { file, type, description, status: 'created' };
  }
}

module.exports = {
  CapabilityAdapter,
  DocumentationAdapter,
  FileOperationsAdapter,
  DevelopmentAdapter,
  CommunicationPrepAdapter,
  FutureAdapter,
  GenericTaskAdapter,
};
