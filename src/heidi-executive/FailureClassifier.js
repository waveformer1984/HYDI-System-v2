/**
 * HEIDI Operational Intelligence — Failure Classifier
 *
 * Bounded failure taxonomy. Never hallucinates a cause.
 */

const TAXONOMY = {
  APPLICATION_FAILURE: ['module_not_found', 'cannot find module', 'syntaxerror', 'referenceerror', 'typeerror', 'uncaught exception'],
  CONTAINER_FAILURE: ['container', 'exited', 'restarting', 'crash loop', 'container not found'],
  DOCKER_RUNTIME_FAILURE: ['docker daemon', 'cannot connect to docker', 'docker api', 'dockerd', 'failed to connect to the docker'],
  WSL_RUNTIME_FAILURE: ['wsl', 'the operation timed out', 'wsl_distro', 'no such file or directory'],
  DATABASE_FAILURE: ['postgres', 'postgresql', 'pgrst', 'connection refused', 'database', 'db connection'],
  CACHE_FAILURE: ['redis', 'cache', 'redis connection'],
  NETWORK_FAILURE: ['econnrefused', 'enotfound', 'etimedout', 'network', 'socket hang up', 'connection refused'],
  PORT_FAILURE: ['eaddrinuse', 'port', 'already in use', 'listen eaddrinuse'],
  DEPENDENCY_FAILURE: ['dependency', 'not ready', 'dependency not healthy', 'unhealthy'],
  RESOURCE_EXHAUSTION: ['memory', 'out of memory', 'enomem', 'disk full', 'no space left', 'cpu', 'resource'],
  CONFIGURATION_FAILURE: ['env', 'configuration', 'config', 'missing env', 'invalid configuration'],
  AUTHENTICATION_FAILURE: ['auth', 'unauthorized', 'forbidden', 'invalid token', 'hmac'],
  UNKNOWN_FAILURE: [],
};

class FailureClassifier {
  constructor(taxonomy = TAXONOMY) {
    this.taxonomy = taxonomy;
  }

  classify(symptom) {
    const error = String(symptom.error || symptom.detail || symptom.message || symptom || '').toLowerCase();
    const type = String(symptom.type || '').toLowerCase();
    const tokens = `${type} ${error}`.split(/[\s\-_]+/).filter(Boolean);

    for (const [cls, patterns] of Object.entries(this.taxonomy)) {
      for (const pattern of patterns) {
        if (error.includes(pattern)) {
          return { failure_class: cls, confidence: 'MEDIUM', matched: pattern };
        }
      }
    }

    // If no direct match, infer from state vocabulary.
    if (type.includes('degraded')) return { failure_class: 'DEPENDENCY_FAILURE', confidence: 'LOW', matched: 'degraded state' };
    if (type.includes('unavailable')) return { failure_class: 'DEPENDENCY_FAILURE', confidence: 'LOW', matched: 'unavailable state' };

    return { failure_class: 'UNKNOWN_FAILURE', confidence: 'LOW', matched: null };
  }

  list() {
    return Object.keys(this.taxonomy);
  }
}

module.exports = { FailureClassifier, TAXONOMY };
