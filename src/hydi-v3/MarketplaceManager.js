'use strict';

const { EventEmitter } = require('events');
const RepositoryManager = require('./RepositoryManager');
const CapabilityRegistry = require('./CapabilityRegistry');
const PublisherRegistry = require('./PublisherRegistry');
const SignatureVerifier = require('./SignatureVerifier');
const DependencyResolver = require('./DependencyResolver');
const CapabilityInstaller = require('./CapabilityInstaller');
const CapabilitySandbox = require('./CapabilitySandbox');

class MarketplaceManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.repositories = config.repositoryManager || new RepositoryManager(config);
    this.capabilities = config.capabilityRegistry || new CapabilityRegistry(config);
    this.publishers = config.publisherRegistry || new PublisherRegistry(config);
    this.verifier = config.signatureVerifier || new SignatureVerifier({ publisherRegistry: this.publishers, logger: config.logger });
    this.resolver = config.dependencyResolver || new DependencyResolver({ repository: this.repositories, hydiVersion: config.hydiVersion });
    this.sandbox = config.sandbox || new CapabilitySandbox({ logger: config.logger });
    this.installer = config.capabilityInstaller || new CapabilityInstaller({
      registry: this.capabilities,
      publisherRegistry: this.publishers,
      signatureVerifier: this.verifier,
      dependencyResolver: this.resolver,
      sandbox: this.sandbox,
      snapshotManager: config.snapshotManager || null,
      lifecycleRegistry: config.lifecycleRegistry || null,
      allowUnsigned: config.allowUnsigned,
      logger: config.logger,
    });
    this.logger = config.logger || console;
    this.audit = [];
  }

  search(query = {}) {
    return this.repositories.search(query);
  }

  async install(id, options = {}) {
    const cap = this.repositories.getCapability(id);
    if (!cap) return { success: false, error: 'capability_not_found' };
    const result = await this.installer.install(cap, options);
    this.audit.push({ at: Date.now(), action: 'install', id, result });
    this.emit('installed', result);
    return result;
  }

  async update(id, options = {}) {
    const current = this.capabilities.get(id);
    const latest = this.repositories.getCapability(id);
    if (!latest) return { success: false, error: 'capability_not_found' };
    if (current && current.version === latest.version) return { success: false, error: 'already_latest' };
    const result = await this.installer.install(latest, options);
    this.audit.push({ at: Date.now(), action: 'update', id, result });
    return result;
  }

  async remove(id) {
    const result = await this.installer.uninstall(id);
    this.audit.push({ at: Date.now(), action: 'remove', id, result });
    this.emit('removed', result);
    return result;
  }

  async rollback(installationId) {
    const result = await this.installer.rollback(installationId);
    this.audit.push({ at: Date.now(), action: 'rollback', installationId, result });
    this.emit('rollback', result);
    return result;
  }

  verify(capability, options = {}) {
    return this.verifier.verify(capability, options);
  }

  publish(repoId, capability, publisherId) {
    const repo = this.repositories.listRepositories().find((r) => r.id === repoId);
    if (!repo) return { success: false, error: 'repository_not_found' };
    if (publisherId && this.publishers.isRevoked(publisherId)) return { success: false, error: 'publisher_revoked' };
    this.repositories.publish(repoId, capability);
    this.publishers.addPackage(publisherId || capability.publisher, capability.id);
    this.emit('published', { repoId, capabilityId: capability.id });
    return { success: true, id: capability.id, repository: repoId };
  }

  listInstalled() {
    return this.capabilities.list();
  }

  listRepositories() {
    return this.repositories.listRepositories();
  }

  getAudit(limit = 100) {
    return this.audit.slice(-limit);
  }
}

module.exports = MarketplaceManager;
