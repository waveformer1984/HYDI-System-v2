'use strict';

const BaseConnector = require('./BaseConnector');

class GitHubConnector extends BaseConnector {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['GitHubCommit', 'GitHubPullRequest', 'GitHubIssue'];
    this._requiredCredentials = ['GITHUB_TOKEN'];
  }

  async start() {
    if (!this._isEnabled()) {
      this._notConfigured('disabled');
      return;
    }
    if (!this._hasCredentials(this._requiredCredentials)) {
      this._notConfigured('GITHUB_TOKEN not configured');
      return;
    }
    this.state = 'configured';
  }

  async stop() {
    this.state = 'stopped';
  }
}

module.exports = GitHubConnector;
